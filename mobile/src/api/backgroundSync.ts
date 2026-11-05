/**
 * Draining the offline queue while the app is closed (SRS §6.9, and the field's "it should just
 * sync" taken one step further than the in-app drain can reach).
 *
 * The in-app pipeline — `navigation/index.tsx` — already sends what is queued the moment the
 * network returns, the app comes to the front, or a 15-second tick fires *while the app is
 * open*. What it cannot do is run when the Mait has locked the phone and put it in a pocket, or
 * when Android has killed the process to reclaim memory. A round finished in a dead valley and a
 * handset pocketed before signal returns would then wait for the next launch to go up.
 *
 * This closes that gap. `expo-background-task` is backed by Android's WorkManager, so the OS
 * wakes the app in the background on its own schedule (a ~15-minute floor, never guaranteed to
 * the minute) and runs the task below even with the app swiped away. It is the periodic safety
 * net the field asked for: best-effort by nature — an aggressive OEM battery saver can delay or
 * withhold it — which is exactly why it is a *second* path, not a replacement. The in-app drain
 * stays the fast one; this catches whatever the app was never open to send.
 *
 * **It runs in a fresh JavaScript context.** A headless wake is not the app the Mait signed in
 * to: Redux is empty, and the module-level API address in `env.ts` is back at the value the
 * build shipped with. So the task reads both off disk itself — the last-good server address
 * (`restoreServerAddress`) and the session (`loadSession`) — before it sends anything. Miss the
 * first and it would fire every request at the build's default host; miss the second and it has
 * no token to sign them with.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { apiBaseUrl } from '@/config/env';
import { restoreServerAddress } from '@/config/serverAddress';
import { loadSession, saveSession } from '@/features/auth/session';
import { readQueue } from './queue';
import { drainQueue } from './sync';

/** The WorkManager task name. Stable: it is what registration and OS scheduling key on. */
export const BACKGROUND_SYNC_TASK = 'maitai.background-sync.v1';

/** How long the headless token refresh may take before it is abandoned, as elsewhere in sync. */
const REFRESH_CAP_MS = 30_000;

/**
 * Defined at module load, in the global scope, so the task exists the moment Android wakes the
 * app headless — long before any React component would mount. This module is imported for its
 * side effect in `index.js`, which is the app's entry on every launch, headless or not.
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    // The address the handset last found working, before a single request goes out — a fresh
    // context has only the build's default otherwise.
    await restoreServerAddress();

    // Nothing queued means nothing to wake for. Cheap, and it keeps a healthy handset's
    // background pass free.
    const pending = await readQueue();
    if (pending.length === 0) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // No session on disk: the Mait is signed out, and there is no token to send under. Not a
    // failure — there is simply nothing this run can do.
    const session = await loadSession();
    if (!session) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    /**
     * Refresh an expired access token mid-drain, the same single refresh-and-retry the online
     * path and the in-app drain use (SRS §16). The headset has been idle for at least the
     * background interval, so the access token minted at sign-in has almost certainly aged out;
     * the refresh token lasts a week. A success is written back to SecureStore so the *next*
     * background wake starts on a current token rather than refreshing again.
     */
    const reauth = async (): Promise<string | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REFRESH_CAP_MS);
      try {
        const response = await fetch(`${apiBaseUrl()}/auth/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ refresh: session.refreshToken }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return null;
        }
        const tokens = (await response.json()) as { access?: string; refresh?: string };
        if (!tokens.access) {
          return null;
        }
        await saveSession({
          ...session,
          accessToken: tokens.access,
          refreshToken: tokens.refresh ?? session.refreshToken,
        });
        return tokens.access;
      } catch {
        // A refresh that never reached the server, or a timed-out socket: leave the session be
        // and let the queue wait for the next wake. A dead network is not a dead session.
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    await drainQueue(session.accessToken, undefined, reauth);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // An unexpected failure asks WorkManager to try again later; the queue is untouched and
    // every job is idempotent, so a retry can only re-send what did not land.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Ask the OS to run the drain in the background from now on.
 *
 * Idempotent and best-effort: called at every launch, it registers once and does nothing
 * thereafter, and it stays silent where the OS will not allow background work at all (battery
 * saver, a restricted app) rather than treating that as an error — the in-app drain still runs.
 */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      return;
    }
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!already) {
      // Minutes. 15 is WorkManager's floor; the OS may run it less often, never more.
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
    }
  } catch {
    // Registration is a convenience, not a requirement. The app syncs while open regardless.
  }
}
