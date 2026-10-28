'use client';

import { exportLegacyRecovery, type LegacyRecoverySource } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from '@locales/useTranslation';

export interface UnreadableDraftCopy {
  source: LegacyRecoverySource;
  title: string;
  content: string;
}

/** A read-only view: authored words and original bytes stay separate from typed restore. */
export default function UnreadableDraftCopies({ owner, copies, failed = false }: {
  owner: string | null | undefined;
  copies: readonly UnreadableDraftCopy[];
  failed?: boolean;
}) {
  const { t } = useTranslation();
  const { copyToClipboard, isLoading, isCopied, error } = useClipboard();
  const owned = copies.filter(copy => copy.source.owner === owner);
  if (!owner || (!owned.length && !failed)) return null;
  return <>
    {(failed || error) && <p role="alert">{t('legacyRecovery.actionFailed')}</p>}
    {isCopied && <p role="status">{t('common.copied')}</p>}
    {owned.map(({ source, title, content }) => {
      const words = [title, content].filter(Boolean).join('\n\n');
      return <section key={source.id} role="alert" className="relative mb-6 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">{t('unsavedDraft.unreadableTitle')}</h2>
        <p>{t('unsavedDraft.unreadableDescription')}</p>
        {title && <h3 className="break-words font-medium">{title}</h3>}
        {content && <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{content}</p>}
        <details>
          <summary className="cursor-pointer">{t('legacyRecovery.preview')}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{source.raw}</pre>
        </details>
        <div className="flex flex-wrap gap-2">
          {words && <button type="button" disabled={isLoading} onClick={() => { void copyToClipboard(words); }} className="rounded-lg border border-amber-300 px-3 py-2">{t('unsavedDraft.copyText')}</button>}
          <button type="button" disabled={isLoading} onClick={() => { void copyToClipboard(exportLegacyRecovery(source, owner)); }} className="rounded-lg border border-amber-300 px-3 py-2">{t('unsavedDraft.copyOriginal')}</button>
        </div>
      </section>;
    })}
  </>;
}
