'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRemotePeek } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { useConfirm } from '@/hooks/useConfirm';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { serializeContent } from '@/utils/contentFingerprint';
import { ownsPreparationCopy, preparationCopyText, preparationEcho, readLegacyPreparation, removeLegacyPreparation } from '@/utils/legacyPreparationRecovery';
import { fieldLabel } from '@/utils/storedFieldLabel';
import { storedFieldValue } from '@/utils/storedFieldValue';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { LegacyPreparationCopy } from '@/utils/legacyPreparationRecovery';

/** Old preparation is evidence to copy, never a baseline or an automatic sermon update. */
export function LegacyPreparationRecovery({ owner, confirmed }: { owner: string | null; confirmed: ResourceSnapshot | null }) {
  const { t } = useTranslation();
  const peek = useRemotePeek({ fresh: true });
  const online = useOnlineStatus();
  const { copyToClipboard, isLoading } = useClipboard();
  const { confirm, confirmDialog, withdraw } = useConfirm();
  const identity = ownsPreparationCopy(owner, confirmed) ? JSON.stringify([owner, confirmed.resource.id]) : null;
  // Controllers clone a checkpoint on every draft update. Only confirmed version changes
  // can require another remote comparison; typing must not become a network read loop.
  const confirmedVersion = confirmed?.metadata ? serializeContent(confirmed.metadata) : serializeContent(confirmed?.value?.preparation);
  const current = useRef({ identity, confirmedVersion, owner, confirmed }); current.current = { identity, confirmedVersion, owner, confirmed };
  const [state, setState] = useState<{ identity: string; copies: LegacyPreparationCopy[]; failed: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const { owner, confirmed } = current.current;
    if (!identity || !owner || !confirmed) return;
    let active = true, sequence = 0;
    const isCurrent = (request: number) => active && current.current.identity === identity && current.current.confirmedVersion === confirmedVersion && request === sequence;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const copies = readLegacyPreparation(owner, confirmed);
        if (!isCurrent(request)) return;
        setState({ identity, copies, failed: false });
        if (!copies.length || !peek) return;
        let server: ResourceSnapshot;
        try { server = await peek(confirmed.resource); } catch { return; }
        if (!isCurrent(request)) return;
        for (const copy of copies) if (preparationEcho(copy, server)) removeLegacyPreparation(copy, owner, server);
        if (isCurrent(request)) setState({ identity, copies: readLegacyPreparation(owner, confirmed), failed: false });
      } catch {
        if (isCurrent(request)) setState(previous => ({ identity, copies: previous?.identity === identity ? previous.copies : [], failed: true }));
      }
    };
    void refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === `draft:v1:${owner}:${confirmed.resource.id}:preparation`
        || event.key === `prep-draft-backup-${confirmed.resource.id}`) void refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible); withdraw(); };
  }, [identity, confirmedVersion, online, peek, revision, withdraw]);
  const shown = state?.identity === identity ? state : null;
  const activeCopy = (copy: LegacyPreparationCopy) => current.current.identity === identity && owner === copy.owner
    && ownsPreparationCopy(owner, current.current.confirmed) && current.current.confirmed.resource.id === copy.sermonId;
  const fail = () => { if (identity && current.current.identity === identity) setState(previous => ({ identity, copies: previous?.identity === identity ? previous.copies : [], failed: true })); };
  const text = (copy: LegacyPreparationCopy) => preparationCopyText(
    storedFieldValue(t, 'sermons', 'preparation', copy.value) as Record<string, unknown>,
    field => fieldLabel(t, field), value => t(value ? 'legacyRecovery.valueOn' : 'legacyRecovery.valueOff'));
  const download = (copy: LegacyPreparationCopy) => {
    if (!activeCopy(copy)) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([copy.raw], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'saved-preparation.json'; anchor.click();
    } catch { fail(); } finally { if (url) URL.revokeObjectURL(url); }
  };
  const discard = async (copy: LegacyPreparationCopy) => {
    if (!activeCopy(copy) || !await confirm({ title: { key: 'legacyPreparation.discardTitle' },
      description: { key: 'legacyPreparation.discardBody' }, confirmText: { key: 'common.delete' } })) return;
    if (!activeCopy(copy) || !owner || !current.current.confirmed) return;
    try { removeLegacyPreparation(copy, owner, current.current.confirmed); setRevision(value => value + 1); } catch { fail(); }
  };
  return <>
    {shown?.failed && <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">{t('legacyRecovery.actionFailed')}</p>}
    {Boolean(shown?.copies.length) && <section aria-label={t('legacyPreparation.title')} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 className="font-semibold">{t('legacyPreparation.title')}</h2>
      <p className="mt-1">{t('legacyPreparation.body')}</p>
      {shown?.copies.map(copy => <article key={copy.key} className="mt-3 border-t border-amber-200 pt-3 dark:border-amber-500/30">
        <details><summary className="cursor-pointer font-medium">{t('legacyRecovery.preview')}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">{text(copy)}</pre>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={isLoading} onClick={() => { if (activeCopy(copy)) void copyToClipboard(text(copy)).then(copied => { if (!copied && activeCopy(copy)) fail(); }, fail); }} className="rounded-lg border border-amber-300 px-3 py-1.5">{t('legacyPreparation.copyText')}</button>
          <button type="button" onClick={() => download(copy)} className="rounded-lg border border-amber-300 px-3 py-1.5">{t('legacyRecovery.export')}</button>
          <button type="button" onClick={() => { void discard(copy); }} className="rounded-lg border border-amber-300 px-3 py-1.5">{t('legacyPreparation.discard')}</button>
        </div>
      </article>)}
    </section>}
    {confirmDialog}
  </>;
}
