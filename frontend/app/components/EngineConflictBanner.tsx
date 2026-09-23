'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { isCollectionOnEngine, useDataEngine, useDocumentActions } from '@/data-engine/react.client';

import type { DocumentData, ResourceRef } from '@/data-engine/types';

/**
 * Collections whose screens write through one-shot engine actions (useDocumentActions) and so
 * have no open editor to show a late conflict. Councils, groups, series and sermons resolve in
 * their own pinned editors and are deliberately not listed here.
 */
const ONE_SHOT_COLLECTIONS = ['prayerRequests', 'serviceOrders', 'studyNotes', 'tags', 'planTemplates'];
const TEXT_FIELDS = ['title', 'name', 'description', 'content', 'answerText', 'summary'];

interface Waiting { resource: ResourceRef; text: string }

/** The words this device kept, so the choice is made looking at them. */
function draftText(draft: DocumentData | null): string {
  if (!draft) return '';
  return TEXT_FIELDS.map(field => draft[field]).filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(' · ');
}

/**
 * A CHANGE THE SERVER DID NOT TAKE, FOR A DOCUMENT NO SCREEN HAS OPEN.
 *
 * A one-shot action is accepted once the engine holds it on this device. When another device
 * changed the same field meanwhile, the server answers with a conflict after that — and the
 * list then shows the stored version while this device's words wait in a checkpoint nobody
 * opens. This banner is that door, app-wide like the legacy OutboxConflictBanner: it lists the
 * checkpoints that wait for a decision (edited, nothing in flight) and settles them in place.
 */
export function EngineConflictBanner({ pollMs = 5_000 }: { pollMs?: number }) {
  return ONE_SHOT_COLLECTIONS.some(isCollectionOnEngine) ? <EngineConflicts pollMs={pollMs} /> : null;
}

function EngineConflicts({ pollMs }: { pollMs: number }) {
  const { t } = useTranslation();
  const { browser, owner } = useDataEngine();
  const actions = useDocumentActions();
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!browser || !owner) { setWaiting([]); return; }
    try {
      const records = await browser.engine.listRecoverable();
      setWaiting(records.filter(({ record }) => {
        const { checkpoint } = record;
        // Waiting for a decision: the server's answer is a conflict, or an edited draft has
        // nothing in flight. Work that is only queued offline is neither and stays silent.
        const decided = checkpoint.conflicts.length > 0
          || (checkpoint.dirty && Object.keys(checkpoint.pending).length === 0 && record.prepared === null);
        return ONE_SHOT_COLLECTIONS.includes(checkpoint.confirmed.resource.collection) && isCollectionOnEngine(checkpoint.confirmed.resource.collection)
          && checkpoint.confirmed.value !== null && decided;
      }).map(({ record }) => ({ resource: record.checkpoint.confirmed.resource, text: draftText(record.checkpoint.draft) })));
    } catch (error) {
      // Before the engine knows its owner there is nothing of this person's to list yet.
      if (!(error instanceof Error && error.message === 'Authentication required')) console.error('Engine conflicts could not be listed', error);
    }
  }, [browser, owner]);

  useEffect(() => {
    void refresh();
    if (!browser) return undefined;
    // A late conflict arrives as a delivery result: every journal change is a reason to look again.
    const stop = browser.engine.subscribePending(() => { void refresh(); });
    // The result is written into the checkpoint after the journal moves, so a local re-read on a
    // short clock catches it too. It reads this device's IndexedDB only — no database reads.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, pollMs);
    return () => { stop(); window.clearInterval(timer); };
  }, [browser, refresh, pollMs]);

  const entry = waiting[0];
  if (!entry) return null;

  const settle = async (choice: 'mine' | 'theirs') => {
    if (busy) return;
    setBusy(true);
    try { await actions.resolve(entry.resource, choice); }
    catch (error) {
      console.error('Engine conflict could not be settled', error);
      toast.error(t('common.saveError'));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <SaveConflictBanner
      entityKey={entry.resource.collection === 'studyNotes' ? 'entityNote' : 'entityRecord'}
      pendingText={entry.text || undefined}
      onKeepMine={() => { void settle('mine'); }}
      onTakeTheirs={() => { void settle('theirs'); }}
      busy={busy}
      className="mb-3"
    />
  );
}
