import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { StaleWriteError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PRAYER_CORE_AGGREGATE, PRAYER_STATUS_AGGREGATE } from '@/services/prayerRequests.client';
import { newClientId } from '@/utils/clientId';
import { queuedMutation, skippedWrite, type WriteSubmission } from '@/utils/recoverableWrite';

import type { DocumentData } from '@/data-engine/types';
import type { PrayerRequest, PrayerStatus } from '@/models/models';

type CreatePrayerPayload = Pick<PrayerRequest, 'userId' | 'title'> &
  Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>> & { recoveryDraft?: string };
interface Conflict<T> { payload: T; actualRevision: number }
type SaveConflictPayload = { id: string; updates: Partial<PrayerRequest> };
type StatusConflictPayload = { id: string; status: PrayerStatus; answerText?: string };

const resource = (id: string) => ({ collection: 'prayerRequests', id });
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * PRAYERS ON THE ENGINE — the same interface as the legacy hook (usePrayerRequests), so the
 * screens do not change. Rows come from the engine collection; each action is one engine
 * command. The legacy guard is kept: a field changed elsewhere since the person opened it
 * (`expectedBaseline`) refuses the save with a StaleWriteError, the screen offers
 * keep-mine / take-theirs, and keep-mine re-sends without the baseline.
 */
export function usePrayerRequestsEngine(userId: string | null | undefined, enabled: boolean) {
  const { t } = useTranslation();
  /**
   * A queued write is accepted at launch, so a later failure has no other voice: the legacy
   * hook spoke through its mutation-cache descriptors, which the engine path does not create.
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
  const [saveConflict, setSaveConflictState] = useState<Conflict<SaveConflictPayload> | null>(null);
  const [statusConflict, setStatusConflictState] = useState<Conflict<StatusConflictPayload> | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const pending = useRef(new Set<string>());

  const prayerRequests = useMemo<PrayerRequest[]>(() => (collection.state?.documents ?? [])
    .flatMap(row => row.value ? [{ ...(row.value as unknown as PrayerRequest), id: row.resource.id }] : [])
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [collection.state?.documents]);

  /** One edit that honours an optional per-field baseline; resolves to the refusal, if any. */
  const guardedEdit = useCallback(async (id: string, aggregate: string, patch: DocumentData,
    baseline?: Record<string, unknown> | null): Promise<StaleWriteError | null> => {
    let refusal: StaleWriteError | null = null;
    await actions.commit(resource(id), current => {
      if (!current) throw new Error('The prayer was deleted');
      const changedElsewhere = baseline ? Object.keys(baseline).filter(field =>
        !same(current[field], baseline[field]) && !same(current[field], patch[field])) : [];
      if (changedElsewhere.length) {
        const revision = (current.rev as Record<string, number> | undefined)?.[aggregate] ?? 0;
        refusal = new StaleWriteError(aggregate, revision, revision,
          Object.fromEntries(changedElsewhere.map(field => [field, current[field] ?? null])));
        return current;
      }
      return { ...current, ...patch, updatedAt: now() };
    });
    return refusal;
  }, [actions]);

  const once = (key: string, run: () => Promise<void>): WriteSubmission => {
    if (pending.current.has(key)) return skippedWrite();
    pending.current.add(key);
    return queuedMutation(key, reportLate(run()).finally(() => pending.current.delete(key)));
  };

  const updatePrayer = (id: string, updates: Partial<PrayerRequest>, _expectedRevision?: number | null,
    expectedBaseline?: Record<string, unknown> | null): WriteSubmission =>
    once(`prayer:update:${id}:${JSON.stringify(updates)}`, async () => {
      const refusal = await guardedEdit(id, PRAYER_CORE_AGGREGATE, updates as DocumentData, expectedBaseline);
      if (refusal) { setSaveConflictState({ payload: { id, updates }, actualRevision: refusal.actualRevision }); throw refusal; }
      setSaveConflictState(current => current?.payload.id === id ? null : current);
    });

  const statusPatch = (status: PrayerStatus, answerText?: string): DocumentData => {
    const at = now();
    return { status, ...(answerText !== undefined ? { answerText } : {}), ...(status === 'answered' ? { answeredAt: at } : {}) } as DocumentData;
  };

  const setStatus = (id: string, status: PrayerStatus, answerText?: string, _expectedRevision?: number | null,
    expectedBaseline?: Record<string, unknown> | null): WriteSubmission =>
    once(`prayer:status:${id}:${status}:${answerText ?? ''}`, async () => {
      const refusal = await guardedEdit(id, PRAYER_STATUS_AGGREGATE, statusPatch(status, answerText), expectedBaseline);
      if (refusal) { setStatusConflictState({ payload: { id, status, answerText }, actualRevision: refusal.actualRevision }); throw refusal; }
      setStatusConflictState(current => current?.payload.id === id ? null : current);
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
    createPrayer: (payload: CreatePrayerPayload): WriteSubmission & { prayerId: string } => {
      const id = newClientId();
      const at = now();
      const { recoveryDraft: _draft, ...fields } = payload;
      return {
        ...queuedMutation(`prayer:create:${id}`, reportLate(actions.create(resource(id), JSON.parse(JSON.stringify({
          ...fields, status: 'active', updates: [], createdAt: at, updatedAt: at,
        })) as DocumentData))),
        prayerId: id,
      };
    },
    updatePrayer,
    setStatus,
    saveConflict,
    resolvingConflict,
    // Keeping mine re-sends the same fields without the baseline: a deliberate overwrite.
    keepMineOnConflict: () => saveConflict ? resolve(() => guardedEdit(saveConflict.payload.id, PRAYER_CORE_AGGREGATE,
      saveConflict.payload.updates as DocumentData, null), () => setSaveConflictState(null)) : Promise.resolve(),
    takeTheirsOnConflict: async () => { setSaveConflictState(null); },
    statusConflict,
    keepMineOnStatusConflict: () => statusConflict ? resolve(() => guardedEdit(statusConflict.payload.id, PRAYER_STATUS_AGGREGATE,
      statusPatch(statusConflict.payload.status, statusConflict.payload.answerText), null), () => setStatusConflictState(null)) : Promise.resolve(),
    takeTheirsOnStatusConflict: () => { setStatusConflictState(null); },
    deletePrayer: (id: string): WriteSubmission => once(`prayer:delete:${id}`, () => actions.remove(resource(id))),
    addUpdate: (id: string, text: string): WriteSubmission => {
      const entry = { id: newClientId(), text, createdAt: now() };
      return queuedMutation(`prayer:update:${entry.id}`, reportLate(actions.commit(resource(id), current => {
        if (!current) throw new Error('The prayer was deleted');
        const updates = Array.isArray(current.updates) ? current.updates : [];
        return { ...current, updates: [...updates, entry], updatedAt: now() };
      })));
    },
  };
}
