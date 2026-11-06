import { useTranslation } from '@locales/useTranslation';

/** The same refusal and recovery for the search window and its retained results. */
export function SearchPreparationFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <span>{t('bible.search.preparationFailed')}</span>
      <button type="button" onClick={onRetry} className="rounded-lg border border-current px-2 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        {t('bible.search.retryPreparation')}
      </button>
    </div>
  );
}
