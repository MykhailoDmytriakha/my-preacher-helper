'use client';

import { useRunningBuildBehind } from '@/hooks/useRunningBuildBehind';
import { reloadPage } from '@/utils/reloadPage';
import { useTranslation } from '@locales/useTranslation';

/**
 * A CHANGE THE SERVER REFUSED, ON A TAB OLDER THAN THE SERVER: SAY THE WAY OUT.
 *
 * BUG-20261107-outdated-tab-refusal-unexplained. A tab open across a deploy keeps the code it loaded;
 * when the deploy tightened what the server accepts (07.11: an analysis edit must carry its whole passage
 * frame), every change from that tab is refused. The screen said only "changes refused, draft kept" with
 * keep/take choices — and the old code's "keep mine" is refused again, so the person went round eight
 * times and finally took the server's version, losing the change.
 *
 * Only a refusal asks: a conflict is a matter of the data, not of the code. The question itself is
 * `useRunningBuildBehind` over `isRunningBuildBehind` — the one the header's update button asks — and
 * nothing is claimed unless both versions are known and differ. The notice adds the way out and takes
 * no choice away: the draft is durable on this device, and after the reload the current code sends it.
 */
export function OutdatedTabNotice({ refused, className = '' }: { refused: boolean; className?: string }) {
  const { t } = useTranslation();
  const behind = useRunningBuildBehind(refused);
  if (!behind) return null;
  return (
    <div role="alert" className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 ${className}`}>
      <p>{t('dataSync.outdatedTab.body')}</p>
      <button type="button" onClick={reloadPage}
        className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700">
        {t('dataSync.outdatedTab.action')}
      </button>
    </div>
  );
}
