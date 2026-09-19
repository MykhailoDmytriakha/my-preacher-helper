'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { listLegacyQueryCopies, preserveLegacyQueryCache, type LegacyQueryCopy } from './legacyQueryRecovery.client';

/** Mount before React Query: even expired caches must be archived before its restore can remove them. */
export function LegacyQueryMigrationGate({ enabled, children }: { enabled: (collection: string) => boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending');
  useEffect(() => {
    let active = true;
    setState('pending');
    void preserveLegacyQueryCache(enabled).then(() => { if (active) setState('ready'); }, () => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [enabled, attempt]);
  if (state === 'ready') return <>{children}</>;
  return <div role={state === 'failed' ? 'alert' : 'status'} className="m-4 rounded-xl border p-4">
    <p>{t(state === 'failed' ? 'legacyRecovery.preservationFailed' : 'legacyRecovery.preserving')}</p>
    {state === 'failed' && <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>{t('dataSync.retry')}</button>}
  </div>;
}

export function LegacyQueryCopies({ owner }: { owner: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ owner: string; copies: LegacyQueryCopy[]; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void listLegacyQueryCopies(owner).then(copies => { if (active) setState({ owner, copies, failed: false }); }, () => {
      if (active) setState({ owner, copies: [], failed: true });
    });
    return () => { active = false; };
  }, [owner]);
  const current = state?.owner === owner ? state : null;
  const download = (copy: LegacyQueryCopy) => {
    if (copy.owner !== owner) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([copy.raw], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `saved-${copy.collection}-copy.json`; anchor.click();
    } catch { setState(previous => previous?.owner === owner ? { ...previous, failed: true } : previous); }
    finally { if (url) URL.revokeObjectURL(url); }
  };
  return <>
    {current?.failed && <p role="alert">{t('legacyRecovery.actionFailed')}</p>}
    {Boolean(current?.copies.length) && <details className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <summary>{t('legacyRecovery.cacheTitle', { count: current!.copies.length })}</summary>
      <p className="my-2">{t('legacyRecovery.cacheBody')}</p>
      {current!.copies.map(copy => <details key={copy.id} className="my-2">
        <summary>{copy.title}</summary>
        <pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap">{copy.raw}</pre>
        <button type="button" className="rounded-lg border border-amber-300 px-3 py-1.5" onClick={() => download(copy)}>{t('legacyRecovery.export')}</button>
      </details>)}
    </details>}
  </>;
}
