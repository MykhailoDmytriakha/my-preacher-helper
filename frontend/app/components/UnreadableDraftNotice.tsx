'use client';

import { useEffect, useState } from 'react';

import { isDataEngineEnabled, useDataEngine } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from '@locales/useTranslation';

import type { UnreadableCheckpoint } from '@/data-engine/controller';

/** The copy is for reading and copying only. The recovery editor never receives it. */
export function UnreadableDraftNotice() {
  return isDataEngineEnabled() ? <UnreadableDraftCopies /> : null;
}

function UnreadableDraftCopies() {
  const { browser, owner } = useDataEngine();
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ browser: typeof browser; owner: string; copies: UnreadableCheckpoint[] } | null>(null);
  const { copyToClipboard, isCopied, error } = useClipboard();
  useEffect(() => {
    if (!browser || !owner) return;
    let active = true;
    const refresh = () => {
      void browser.engine.listUnreadableCheckpoints().then(copies => {
        if (active) setNotice({ browser, owner, copies });
      }).catch(() => { /* Normal recovery already reports a storage read failure. */ });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [browser, owner]);
  if (!notice || notice.browser !== browser || notice.owner !== owner || !notice.copies.length) return null;
  return <details className="mb-3 rounded-lg border border-amber-400 px-4 py-3 text-sm">
    <summary className="cursor-pointer font-medium">{t('dataSync.unreadableDraftHeading')}</summary>
    <p className="my-2">{t('dataSync.unreadableDraftDescription')}</p>
    <ul className="space-y-2">
      {notice.copies.map(copy => <li key={copy.id}>
        <p>{copy.title || t('dataSync.unreadableDraftUntitled')}</p>
        {copy.text && <details className="mt-1">
          <summary className="cursor-pointer">{t('dataSync.unreadableDraftShow')}</summary>
          <pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{copy.text}</pre>
          <button className="rounded border px-3 py-1" type="button" onClick={() => { void copyToClipboard(copy.text!); }}>
            {t('freshness.copyTextAction')}
          </button>
        </details>}
      </li>)}
    </ul>
    {isCopied && <p role="status">{t('freshness.copiedToast')}</p>}
    {error && <p role="status">{t('common.saveError')}</p>}
  </details>;
}
