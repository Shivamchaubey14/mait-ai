/**
 * Where the offline pack lives on the handset — one JSON file per document.
 *
 * Files rather than AsyncStorage: a Mait's whole working set is thousands of farmers with
 * their animals, and Android's AsyncStorage is a SQLite table capped at a few megabytes for
 * the whole app — a cap the queue and the read cache already share. The document directory has
 * no such cap and is never cleared by the system the way the cache directory can be.
 *
 * Written to a temporary name and moved into place, so a handset that dies mid-write leaves
 * the last good copy rather than half a document. A file that still will not parse is treated
 * as absent, and the next refresh downloads that MPP whole.
 *
 * Kept to four calls and nothing else, so the tests can stand an in-memory map in for it.
 */

import { Directory, File, Paths } from 'expo-file-system';

const FOLDER = 'offline-pack';

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/** The document's text, or null when there is none. */
export async function readPackFile(name: string): Promise<string | null> {
  try {
    const file = new File(folder(), name);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

export async function writePackFile(name: string, text: string): Promise<void> {
  const dir = folder();
  const temporary = new File(dir, `${name}.tmp`);
  temporary.write(text);
  await temporary.move(new File(dir, name), { overwrite: true });
}

export async function removePackFile(name: string): Promise<void> {
  try {
    const file = new File(folder(), name);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Already gone is the outcome that was asked for.
  }
}

/** Every document whose name starts with `prefix`. */
export async function listPackFiles(prefix: string): Promise<string[]> {
  try {
    return folder()
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map(entry => entry.name)
      .filter(name => name.startsWith(prefix) && !name.endsWith('.tmp'));
  } catch {
    return [];
  }
}
