/**
 * Sending an SAP master from the handset, and handing the last one back — the two transfers
 * behind the admin's SAP upload screen.
 *
 * Both run outside RTK Query because both need progress, and `fetch` reports none. The upload
 * goes over `XMLHttpRequest` for `upload.onprogress`, as the AI photo does (`capture.ts`); the
 * download goes through expo-file-system, which writes the bytes to disk as they arrive and
 * says how many have.
 */

import { File, Paths } from 'expo-file-system';

import { apiBaseUrl } from '@/config/env';

import type { UploadJob } from './types';

/** The URL a master is posted to, which is not the type the history reports it as. */
export type MasterEndpoint = 'members' | 'maits' | 'mpp' | 'assignments';
export type MasterType = 'member' | 'mait' | 'mpp';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What the server answered, refusals included — the caller decides what a status means. */
export interface SendResult {
  status: number;
  upload: UploadJob | null;
  /** The server's own words for a refusal, where it gave any. */
  problem: string | null;
}

/** The first readable message in a DRF error body: `detail`, else the first field error. */
function problemOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.detail === 'string') {
    return record.detail;
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

/**
 * Post one master file. `onProgress` gets the fraction sent, or null where the size is not
 * known. Rejects only when the request never reached a server.
 */
export function sendMaster(
  endpoint: MasterEndpoint,
  file: { uri: string; name: string; mimeType?: string | null },
  accessToken: string,
  onProgress: (fraction: number | null) => void,
): Promise<SendResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // React Native's FormData takes a file as a {uri, name, type} part rather than a Blob.
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || XLSX_MIME,
    } as unknown as Blob);

    const request = new XMLHttpRequest();
    request.open('POST', `${apiBaseUrl()}/admin/uploads/${endpoint}/`);
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.setRequestHeader('Accept', 'application/json');
    // Through a tunnel, ngrok answers anything without this with an HTML interstitial.
    request.setRequestHeader('ngrok-skip-browser-warning', 'true');

    if (request.upload) {
      request.upload.onprogress = event => {
        onProgress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
      };
    } else {
      onProgress(null);
    }

    request.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      const ok = request.status >= 200 && request.status < 300;
      resolve({
        status: request.status,
        upload: ok ? (body as UploadJob) : null,
        problem: ok ? null : problemOf(body),
      });
    };
    request.onerror = () => reject(new Error('Network request failed'));
    request.ontimeout = () => reject(new Error('Upload timed out'));
    request.onabort = () => reject(new Error('Upload aborted'));

    request.send(form);
  });
}

/**
 * Where a master download has got to, in the two phases it actually has.
 *
 * An xlsx is a zip and cannot be sent until the server has built all of it, so on the Member
 * master most of the wait is `preparing` — reported as rows copied, polled — and only then do
 * bytes arrive. `fraction` is null where there is nothing yet to be a fraction of.
 */
export type DownloadPhase =
  | { phase: 'preparing'; fraction: number | null }
  | { phase: 'downloading'; fraction: number | null }
  | { phase: 'done' };

/** A key for one download's build progress. Not the master's name: two at once would collide. */
function progressToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fetch the last landed upload of a master into the app's cache and return the file.
 *
 * The caller hands it on to the share sheet: a phone has no Downloads folder an app can write
 * to without asking, and the sheet is where the admin already chooses Drive, Files or Excel.
 */
export async function downloadMaster(
  type: MasterType,
  accessToken: string,
  onProgress: (update: DownloadPhase) => void,
): Promise<File> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'ngrok-skip-browser-warning': 'true',
  };
  const token = progressToken();
  let building = true;
  onProgress({ phase: 'preparing', fraction: null });

  // Chained rather than on an interval, so a slow poll never stacks up behind itself on the
  // same connection that is carrying the download.
  const poll = async (): Promise<void> => {
    if (!building) {
      return;
    }
    try {
      const response = await fetch(
        `${apiBaseUrl()}/admin/uploads/snapshots-progress/?token=${encodeURIComponent(token)}`,
        { headers },
      );
      const position = (await response.json()) as { rows?: number; total?: number };
      if (building && position.total) {
        onProgress({
          phase: 'preparing',
          fraction: Math.min(1, (position.rows ?? 0) / position.total),
        });
      }
    } catch {
      // A dropped poll is not a failed download; the next one may land.
    }
    if (building) {
      setTimeout(poll, 400);
    }
  };
  setTimeout(poll, 250);

  try {
    const target = new File(Paths.cache, `${type}-master.xlsx`);
    const file = await File.downloadFileAsync(
      `${apiBaseUrl()}/admin/uploads/snapshots/${type}/?progress=${encodeURIComponent(token)}`,
      target,
      {
        headers,
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          // The first byte means the build is over, and a build poll still in flight must not
          // paint over the transfer.
          building = false;
          onProgress({
            phase: 'downloading',
            fraction: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null,
          });
        },
      },
    );
    onProgress({ phase: 'done' });
    return file;
  } finally {
    building = false;
  }
}
