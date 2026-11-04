/**
 * Fetching a file the API builds — an export — and handing it to the phone's share sheet.
 *
 * These endpoints need the bearer token, so a plain link would arrive unauthenticated. And a
 * phone has no Downloads folder an app can write to without asking: the share sheet is where
 * an admin already chooses Drive, Files, WhatsApp or Excel, so that is where the file goes.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiBaseUrl } from '@/config/env';

/** The exports are Excel workbooks, so a member code keeps its leading zero. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Download `path` (relative to the API root) into the cache and open the share sheet on it. */
export async function downloadAndShare(
  path: string,
  fileName: string,
  mimeType: string,
  accessToken: string,
): Promise<void> {
  const target = new File(Paths.cache, fileName);
  const file = await File.downloadFileAsync(`${apiBaseUrl()}${path}`, target, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Through a tunnel, ngrok answers anything without this with an HTML interstitial — a
      // page of HTML saved as ai-events.xlsx.
      'ngrok-skip-browser-warning': 'true',
    },
    idempotent: true,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName });
  }
}
