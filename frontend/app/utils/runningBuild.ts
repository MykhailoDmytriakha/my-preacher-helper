import { apiClient } from '@/utils/apiClient';

/**
 * IS THIS TAB RUNNING AN OLDER BUILD THAN THE ONE THE SERVER SERVES NOW?
 *
 * One honest form of the question: the version baked into the running bundle against the version
 * `/api/health` reports (`no-store`, and the service worker never caches `/api`). A tab can stay open
 * for days across many deploys, and code already in memory is never swapped by navigation.
 *
 * Two callers ask it:
 * - `AppUpdateButton` — offers the newer build after the service worker changed hands;
 * - `OutdatedTabNotice` — a change the server refused on such a tab is most likely refused because
 *   the server's rules moved on (BUG-20261107-outdated-tab-refusal-unexplained), and the way out is
 *   a reload, not another "keep mine".
 *
 * Both sides must be known AND different. An unknown version on either side is not evidence of
 * staleness, and locally both read "dev" — which is correctly silent. Offline or no answer: false,
 * because nothing is proven.
 *
 * Asks made while one is under way share its answer: several refusals on one screen are one request.
 */
let asking: Promise<boolean> | null = null;
export function isRunningBuildBehind(): Promise<boolean> {
  asking ??= askServer().finally(() => { asking = null; });
  return asking;
}

async function askServer(): Promise<boolean> {
  const running = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!running) return false;
  try {
    const response = await apiClient('/api/health', { category: 'health', cache: 'no-store' });
    if (!response.ok) return false;
    const { version } = (await response.json()) as { version?: string };
    return Boolean(version) && version !== running;
  } catch {
    return false;
  }
}
