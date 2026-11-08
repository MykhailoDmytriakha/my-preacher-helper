import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { StaleWriteError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PRAYER_CORE_AGGREGATE, PRAYER_STATUS_AGGREGATE } from '@/services/prayerRequests.client';
import { newClientId } from '@/utils/clientId';
import { validPrayerCoreConflict, validPrayerStatusConflict } from '@/utils/refusedDraftPayloads';
import { useTranslation } from '@locales/useTranslation';

import type { PrayerTitleSeen } from '@/data-engine/documentFieldAction';
import type { DocumentData, EditorCommitAction } from '@/data-engine/types';
import type { PrayerRequest, PrayerStatus } from '@/models/models';

type CreatePrayerPayload = Pick<PrayerRequest, 'userId' | 'title'> &
  Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>>;
const clearablePrayerFields = ['description', 'tags'] as const;
type SaveConflictPayload = { id: string; updates: Partial<PrayerRequest>; cleared?: Array<typeof clearablePrayerFields[number]> };

function persistedPrayerPatch(payload: SaveConflictPayload): DocumentData {
  return { ...payload.updates, ...Object.fromEntries((payload.cleared ?? []).map(field => [field, undefined])) } as DocumentData;
}
type StatusConflictPayload = { id: string; status: PrayerStatus; answerText?: string };

const resource = (id: string) => ({ collection: 'prayerRequests', id });
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function authoredPrayerFields(updates: Partial<PrayerRequest>, baseline?: Record<string, unknown> | null): Partial<PrayerRequest> {
  if (!baseline) return updates;
  const patch = { ...updates };
  if (typeof baseline.title === 'string' && patch.title === baseline.title.trim()) delete patch.title;
  const description = typeof baseline.description === 'string' ? baseline.description.trim() || undefined : baseline.description;
  if (Object.hasOwn(baseline, 'description') && same(patch.description, description)) delete patch.description;
  const tags = Array.isArray(baseline.tags) ? baseline.tags.join(',').split(',').map(tag => tag.trim()).filter(Boolean) : undefined;
  if (Object.hasOwn(baseline, 'tags') && same(patch.tags, tags?.length ? tags : undefined)) delete patch.tags;
  return patch;
}

/**
 * PRAYERS ON THE ENGINE — the same interface as the legacy hook (usePrayerRequests), so the
 * screens do not change. Rows come from the engine collection; each action is one engine
 * command. The legacy guard is kept: a field changed elsewhere since the person opened it
 * (`expectedBaseline`) refuses the save with a StaleWriteError, the screen offers
 * keep-mine / take-theirs, and keep-mine re-sends without the baseline. The refused text is held
 * durably per prayer (usePersistedConflict, the same keys as the legacy hook), so leaving the
 * screen or reloading does not throw it away.
 */
export function usePrayerRequestsEngine(userId: string | null | undefined, activeDocId: string | null | undefined, enabled: boolean) {
  const { t } = useTranslation();
  /**
   * A failed local capture has one voice: this hook. The legacy mutation-cache
   * descriptors do not observe engine actions. Server refusals use engine recovery.
   * A conflict is a choice shown by the screen, not a failure, and stays quiet here.
   */
  const reportLate = <T,>(request: Promise<T>): Promise<T> => request.catch((error: unknown) => {
    if (!isStaleWriteError(error)) {
      console.error('Prayer write failed:', error);
      toast.error(t('common.saveError', { defaultValue: 'Failed to save. Please try again.' }));
    }
    throw error;
  });
  const collection = useDataCollection(enabled && userId ? 'prayerRequests' : null);
  const actions = useDocumentActions();
  const [saveConflict, setSaveConflict, , saveConflictChoices] = usePersistedConflict<SaveConflictPayload>(userId ?? null, activeDocId ?? null, PRAYER_CORE_AGGREGATE, validPrayerCoreConflict);
  const [statusConflict, setStatusConflict, , statusConflictChoices] = usePersistedConflict<StatusConflictPayload>(userId ?? null, activeDocId ?? null, PRAYER_STATUS_AGGREGATE, validPrayerStatusConflict);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
  const saveConflictRef = useRef(saveConflict);
  saveConflictRef.current = saveConflict;
  const statusConflictRef = useRef(statusConflict);
  statusConflictRef.current = statusConflict;
  const userIdRef = useRef(userId ?? null);
  userIdRef.current = userId ?? null;
  const activeDocIdRef = useRef(activeDocId ?? null);
  activeDocIdRef.current = activeDocId ?? null;
  const pending = useRef(new Map<string, Promise<void>>());

  useEffect(() => { withdraw(); }, [userId, activeDocId, withdraw]);

  const prayerRequests = useMemo<PrayerRequest[]>(() => (collection.state?.documents ?? [])
    .filter(isLiveCollectionDocument)
    .map(row => ({ ...(row.value as unknown as PrayerRequest), id: row.resource.id }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [collection.state?.documents]);

  const observeTitle = (prayer: PrayerRequest): PrayerTitleSeen | undefined => {
    const id = prayer.id;
    const row = collection.state?.documents?.find(item => item.resource.id === id);
    if (row?.value?.title === prayer.title && row.submittedTitle?.title === prayer.title) return row.submittedTitle;
    const acknowledged = row?.acknowledged;
    const observed = [acknowledged, collection.state?.snapshots?.find(row => row.resource.id === id)].find(row =>
      row?.value?.title === prayer.title && row.metadata && !row.metadata.deleted);
    const metadata = observed?.metadata;
    return metadata ? { title: prayer.title, generation: metadata.generation, revision: metadata.revision } : undefined;
  };

  /** One edit that honours an optional per-field baseline; resolves to the refusal, if any. */
  const guardedEdit = useCallback(async (id: string, aggregate: string, patch: DocumentData,
    baseline?: Record<string, unknown> | null, action?: Extract<EditorCommitAction, { kind: 'prayer-title' }>): Promise<StaleWriteError | null> => {
    let refusal: StaleWriteError | null = null;
    let staleTitle: StaleWriteError | null = null;
    const update = (current: DocumentData | null) => {
      if (!current) throw new Error('The prayer was deleted');
      const revision = (current.rev as Record<string, number> | undefined)?.[aggregate] ?? 0;
      const changedElsewhere = baseline ? Object.keys(baseline).filter(field =>
        !same(current[field], baseline[field]) && !same(current[field], patch[field])) : [];
      const guarded = action ? changedElsewhere.filter(field => field !== 'title') : changedElsewhere;
      if (action) {
        staleTitle = new StaleWriteError(aggregate, revision, revision, { title: current.title ?? null });
      }
      if (guarded.length) {
        refusal = new StaleWriteError(aggregate, revision, revision,
          Object.fromEntries(guarded.map(field => [field, current[field] ?? null])));
        return current;
      }
      return { ...current, ...patch, updatedAt: now() };
    };
    try {
      if (action) await actions.commit(resource(id), update, action);
      else await actions.commit(resource(id), update);
    } catch (error) {
      if (staleTitle && error && typeof error === 'object' && 'code' in error && error.code === 'prayer-title-basis-changed') return staleTitle;
      throw error;
    }
    return refusal;
  }, [actions]);

  const once = (key: string, run: () => Promise<void>): Promise<void> => {
    const scope = JSON.stringify([userId ?? null, key]);
    const captured = pending.current.get(scope);
    if (captured) return captured;
    const request = reportLate(Promise.resolve().then(run)).finally(() => pending.current.delete(scope));
    pending.current.set(scope, request);
    return request;
  };

  const updatePrayer = (id: string, updates: Partial<PrayerRequest>, _expectedRevision?: number | null,
    expectedBaseline?: Record<string, unknown> | null, seenTitle?: PrayerTitleSeen): Promise<void> => {
    const patch = authoredPrayerFields(updates, expectedBaseline);
    if (!Object.keys(patch).length) return Promise.resolve();
    const baseline = expectedBaseline && Object.fromEntries(Object.entries(expectedBaseline).filter(([field]) => Object.hasOwn(patch, field)));
    const action = seenTitle && baseline?.title === seenTitle.title && typeof patch.title === 'string'
      ? { kind: 'prayer-title' as const, title: { seen: seenTitle, time: actions.captureActionTime() ?? null } } : undefined;
    return once(`prayer:update:${id}:${JSON.stringify(patch)}`, async () => {
      const held = saveConflictRef.current;
      const cleared = clearablePrayerFields.filter(field => Object.hasOwn(patch, field) && patch[field] === undefined);
      const captured = held?.payload.id === id && same(persistedPrayerPatch(held.payload), patch)
        && same(held.payload.cleared ?? [], cleared) ? held : null;
      const refusal = await guardedEdit(id, PRAYER_CORE_AGGREGATE, patch as DocumentData, baseline, action);
      if (refusal) {
        setSaveConflict({ payload: { id, updates: patch, ...(cleared.length && { cleared }) }, actualRevision: refusal.actualRevision }, id);
        throw refusal;
      }
      // The same local capture now owns these words; retire only this prayer's conflict.
      if (captured) setSaveConflict(null, id, captured);
    });
  };

  const statusPatch = (status: PrayerStatus, answerText?: string): DocumentData => {
    const at = now();
    return { status, ...(answerText !== undefined ? { answerText } : {}), ...(status === 'answered' ? { answeredAt: at } : {}) } as DocumentData;
  };

  const setStatus = (id: string, status: PrayerStatus, answerText?: string, _expectedRevision?: number | null,
    expectedBaseline?: Record<string, unknown> | null): Promise<void> =>
    once(`prayer:status:${id}:${status}:${answerText ?? ''}`, async () => {
      const held = statusConflictRef.current;
      const captured = held?.payload.id === id && held.payload.status === status && held.payload.answerText === answerText ? held : null;
      const refusal = await guardedEdit(id, PRAYER_STATUS_AGGREGATE, statusPatch(status, answerText), expectedBaseline);
      if (refusal) { setStatusConflict({ payload: { id, status, answerText }, actualRevision: refusal.actualRevision }, id); throw refusal; }
      if (captured) setStatusConflict(null, id, captured);
    });

  const resolve = async (run: () => Promise<StaleWriteError | null>, clear: () => void) => {
    if (resolvingConflict) return;
    setResolvingConflict(true);
    try { if (!(await run())) clear(); } catch (error) { if (!isStaleWriteError(error)) throw error; } finally { setResolvingConflict(false); }
  };

  return {
    prayerRequests,
    loading: Boolean(userId) && collection.loading,
    error: collection.error ? new Error(collection.error) : null,
    refreshPrayers: async () => { await collection.refresh(); },
    createPrayer: (payload: CreatePrayerPayload): Promise<void> & { prayerId: string } => {
      const id = newClientId();
      const at = now();
      const capture = reportLate(actions.create(resource(id), JSON.parse(JSON.stringify({
        ...payload, status: 'active', updates: [], createdAt: at, updatedAt: at,
      })) as DocumentData));
      return Object.assign(capture, { prayerId: id });
    },
    updatePrayer,
    observeTitle,
    setStatus,
    saveConflict,
    saveConflictChoices,
    statusConflictChoices,
    resolvingConflict,
    // Keeping mine re-sends the same fields without the baseline: a deliberate overwrite.
    keepMineOnConflict: () => saveConflict ? resolve(() => guardedEdit(saveConflict.payload.id, PRAYER_CORE_AGGREGATE,
      persistedPrayerPatch(saveConflict.payload), null), () => setSaveConflict(null, saveConflict.payload.id, saveConflict)) : Promise.resolve(),
    // The engine rows are already the current copy: taking theirs only retires the held text.
    takeTheirsOnConflict: async () => {
      const held = saveConflictRef.current;
      if (!held || resolvingConflict) return;
      const capturedUserId = userIdRef.current;
      const capturedDocId = activeDocIdRef.current;
      const isCurrent = () => userIdRef.current === capturedUserId &&
        activeDocIdRef.current === capturedDocId && saveConflictRef.current === held;
      setResolvingConflict(true);
      try {
        await askBeforeDiscard(true, () => setSaveConflict(null, held.payload.id, held), isCurrent);
      } finally {
        setResolvingConflict(false);
      }
    },
    statusConflict,
    keepMineOnStatusConflict: () => statusConflict ? resolve(() => guardedEdit(statusConflict.payload.id, PRAYER_STATUS_AGGREGATE,
      statusPatch(statusConflict.payload.status, statusConflict.payload.answerText), null), () => setStatusConflict(null, statusConflict.payload.id, statusConflict)) : Promise.resolve(),
    takeTheirsOnStatusConflict: async () => {
      const held = statusConflictRef.current;
      if (!held || resolvingConflict) return;
      const capturedUserId = userIdRef.current;
      const capturedDocId = activeDocIdRef.current;
      const isCurrent = () => userIdRef.current === capturedUserId &&
        activeDocIdRef.current === capturedDocId && statusConflictRef.current === held;
      setResolvingConflict(true);
      try {
        await askBeforeDiscard(true, () => setStatusConflict(null, held.payload.id, held), isCurrent);
      } finally {
        setResolvingConflict(false);
      }
    },
    discardDialog,
    deletePrayer: (id: string): Promise<void> => once(`prayer:delete:${id}`, () => actions.remove(resource(id))),
    addUpdate: (id: string, text: string): Promise<void> => {
      const entry = { id: newClientId(), text, createdAt: now() };
      return reportLate(actions.commit(resource(id), current => {
        if (!current) throw new Error('The prayer was deleted');
        const updates = Array.isArray(current.updates) ? current.updates : [];
        return { ...current, updates: [...updates, entry], updatedAt: now() };
      }));
    },
  };
}
