'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { listLegacyQueryCopies, preserveLegacyQueryCache, retireLegacyEchoes, type LegacyQueryCopy, type ServerCopyReader } from './legacyQueryRecovery.client';
import { createIndexedDbSnapshots } from './snapshots.client';

/** Reads the server copy the engine already holds on this device — no request leaves the browser. */
function engineServerCopies(owner: string): ServerCopyReader {
  const snapshots = createIndexedDbSnapshots();
  return async (collection, id) => {
    const snapshot = await snapshots.read(owner, { collection, id });
    return snapshot === undefined ? undefined : snapshot.value;
  };
}
/** Documents the engine has not read yet are compared again later, a bounded number of times. */
const ECHO_RETRY_MS = 30_000;
const ECHO_RETRIES = 5;

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
    {/* Rendered before the language is detected on the server, so the text differs by design. */}
    <p suppressHydrationWarning>{t(state === 'failed' ? 'legacyRecovery.preservationFailed' : 'legacyRecovery.preserving')}</p>
    {state === 'failed' && <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>{t('dataSync.retry')}</button>}
  </div>;
}

export function LegacyQueryCopies({ owner }: { owner: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ owner: string; copies: LegacyQueryCopy[]; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => listLegacyQueryCopies(owner).then(copies => { if (active) setState({ owner, copies, failed: false }); }, () => {
      if (active) setState({ owner, copies: [], failed: true });
    });
    // Copies that say exactly what the server says are retired; whatever differs stays shown.
    const retire = (attempt: number) => {
      void retireLegacyEchoes(owner, engineServerCopies(owner)).then(({ retired, undecided }) => {
        if (!active) return;
        if (retired) void show();
        if (undecided && attempt < ECHO_RETRIES) timer = setTimeout(() => retire(attempt + 1), ECHO_RETRY_MS);
      }, error => { console.error('Previous-version copies could not be compared with the server', error); });
    };
    void show().then(() => { if (active) retire(1); });
    return () => { active = false; if (timer) clearTimeout(timer); };
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
