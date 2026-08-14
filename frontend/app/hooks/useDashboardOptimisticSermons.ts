import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { isOfflineQueuedError, isStaleWriteError, isWriteRefusedError } from '@/services/conflictSafeUpdate.client';
import { newClientId } from '@/utils/clientId';
import {
  DASHBOARD_SERMON_KEY_PREFIX,
  DASHBOARD_SERMON_MUTATION_KEYS,
} from '@/utils/mutationDefaults';
import {
  persistedWrite,
  queuedMutation,
  refusedWrite,
  skippedWrite,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';
import { auth } from '@services/firebaseAuth.service';

import type {
  DashboardCreateSermonInput,
  DashboardEditSermonInput,
  DashboardOptimisticActions,
  DashboardSermonSyncState,
  DashboardSyncOperation,
  PreachDateDraft,
} from '@/models/dashboardOptimistic';
import type { PreachDate, Series, Sermon } from '@/models/models';
import type {
  DashboardSermonCreateVars,
  DashboardSermonDeleteVars,
  DashboardSermonMarkVars,
  DashboardSermonSaveDateVars,
  DashboardSermonUnmarkVars,
  DashboardSermonUpdateVars,
} from '@/utils/mutationDefaults';
import type { TFunction } from 'i18next';

// Dashboard sermon operations on top of React Query persisted mutations (the
// same offline mechanism every other entity uses — see mutationDefaults.ts,
// which holds the mutationFns AND all cache handlers). This hook is a thin
// facade that keeps the original {syncStatesById, actions} API:
//  - each action resolves the uid, mints ids/timestamps (replay-stable: they
//    live in the mutation variables, never inside the mutationFn) and fires a
//    bare useMutation tied to its resumable mutationKey;
//  - the per-sermon sync badges are derived from the mutation cache via
//    useMutationState instead of hand-rolled useState/useRef;
//  - an op made offline pauses (badge: pending), survives a page reload
//    (mutation + optimistic list cache are persisted to IndexedDB) and replays
//    in submission order on reconnect/resume — the old window-'online' flush
//    listener and retryActionsRef closures are gone.
// Ops that fail ONLINE (server error) end up status 'error' after React
// Query's retries: badge shows the message with manual Retry / Dismiss.

interface UseDashboardOptimisticSermonsResult {
  syncStatesById: Record<string, DashboardSermonSyncState>;
  actions: DashboardOptimisticActions;
}

function resolveUid(): string | undefined {
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    return currentUser.uid;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) {
      return undefined;
    }
    const parsed = JSON.parse(guestData) as { uid?: string };
    return parsed.uid;
  } catch {
    return undefined;
  }
}

const PREACH_STATUS_OPERATION: DashboardSyncOperation = 'preach-status';

const OPERATION_BY_KEY: Record<string, DashboardSyncOperation> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  markPreached: PREACH_STATUS_OPERATION,
  unmarkPreached: PREACH_STATUS_OPERATION,
  savePreachDate: PREACH_STATUS_OPERATION,
};

const recoveryMessageFor = (
  operationKey: string | undefined,
  variables: unknown,
  t: TFunction
): string => {
  if (operationKey === 'create') {
    const title = (variables as DashboardSermonCreateVars | undefined)?.input?.title;
    return t('writeRecovery.sermonCreateFailed', { name: title });
  }
  if (operationKey === 'update') {
    const title = (variables as DashboardSermonUpdateVars | undefined)?.input?.title;
    return t('writeRecovery.sermonUpdateFailed', { name: title });
  }
  if (operationKey === 'savePreachDate') {
    const title = (variables as DashboardSermonSaveDateVars | undefined)?.sermon?.title;
    return t('writeRecovery.preachDateFailed', { name: title });
  }
  return t('writeRecovery.sermonFailed');
};

/**
 * EVERYTHING the person entered, not just the two obvious text fields. A planned date is
 * typed, and a series is chosen from a list; leaving them out means the copy offers a
 * draft that is quietly missing part of itself. The series is shown by NAME — an id would
 * be noise to the person reading it — and omitted when the name cannot be resolved.
 */
const recoveryTextFor = (
  operationKey: string | undefined,
  variables: unknown,
  seriesNameOf: (seriesId: string | undefined) => string | undefined
): string | undefined => {
  if (operationKey === 'create') {
    const input = (variables as DashboardSermonCreateVars | undefined)?.input;
    return input
      ? recoveryText([input.title, input.verse, input.plannedDate, seriesNameOf(input.seriesId)])
      : undefined;
  }
  if (operationKey === 'update') {
    const input = (variables as DashboardSermonUpdateVars | undefined)?.input;
    return input
      ? recoveryText([input.title, input.verse, input.plannedDate])
      : undefined;
  }
  if (operationKey === 'savePreachDate') {
    const data = (variables as DashboardSermonSaveDateVars | undefined)?.data;
    return data
      ? recoveryText([data.date, data.church?.name, data.church?.city, data.audience, data.notes])
      : undefined;
  }
  return undefined;
};

/**
 * What makes two writes "the same write". Only the payload matters: ids and timestamps
 * are minted per attempt and would make every submit look unique.
 */
const writeFingerprint = (variables: unknown): string => {
  const payload = variables as { input?: unknown; data?: unknown } | undefined;
  return JSON.stringify(payload?.input ?? payload?.data ?? null);
};

const submissionForMutation = <T,>(receipt: string, request: Promise<T>): WriteSubmission =>
  typeof navigator !== 'undefined' && !navigator.onLine
    ? queuedMutation(receipt, request)
    : persistedWrite(request);

// Structural slice of React Query's Mutation — keeps the helpers usable for
// both useMutationState's select argument and MutationCache.findAll results
// without fighting the Mutation generic's variance.
interface MutationLike {
  mutationId: number;
  options: { mutationKey?: readonly unknown[] };
  state: { variables?: unknown };
}

const sermonIdOf = (mutation: MutationLike): string | undefined =>
  (mutation.state.variables as { sermonId?: string } | undefined)?.sermonId;

const operationOf = (mutation: MutationLike): DashboardSyncOperation | undefined =>
  OPERATION_BY_KEY[String(mutation.options.mutationKey?.[1])];

export function useDashboardOptimisticSermons(): UseDashboardOptimisticSermonsResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addToSeries, removeFromAllSeries } = useSeriesMembership();
  // Read from the cache the series list already fills, so a refusal can name the series
  // the person picked without this hook owning a query of its own.
  const seriesNameOf = (seriesId: string | undefined): string | undefined => {
    if (!seriesId) return undefined;
    const cached = queryClient.getQueryData<Series[]>(['series', resolveUid() ?? null]);
    return cached?.find((series) => series.id === seriesId)?.title || undefined;
  };
  // The badge map, derived live from the mutation cache: latest pending/error
  // mutation per sermon wins. Successful (and dismissed/removed) mutations
  // simply drop out of the map.
  const badgeSnapshots = useMutationState({
    filters: { mutationKey: [DASHBOARD_SERMON_KEY_PREFIX], exact: false },
    select: (mutation) => {
      const operation = operationOf(mutation);
      const operationKey = String(mutation.options.mutationKey?.[1] ?? '');
      return {
        submissionId: mutation.mutationId,
        sermonId: sermonIdOf(mutation),
        operation,
        status: mutation.state.status,
        message: mutation.state.error
          ? isWriteRefusedError(mutation.state.error)
            ? t('writeRecovery.refused')
            : recoveryMessageFor(operationKey, mutation.state.variables, t)
          : undefined,
        recoveryText: mutation.state.error
          ? recoveryTextFor(operationKey, mutation.state.variables, seriesNameOf)
          : undefined,
        // A refusal reads nothing like a network failure and must not be worded like
        // one: the person has to know their text is competing with a newer version.
        conflict: isStaleWriteError(mutation.state.error),
        refused: isWriteRefusedError(mutation.state.error),
        queued: isOfflineQueuedError(mutation.state.error),
        submittedAt: mutation.state.submittedAt ?? 0,
      };
    },
  });

  const syncStatesById: Record<string, DashboardSermonSyncState> = {};
  {
    const latestBySermon: Record<string, number> = {};
    for (const snapshot of badgeSnapshots) {
      if (!snapshot.sermonId || !snapshot.operation) continue;
      if (snapshot.status !== 'pending' && snapshot.status !== 'error') continue;
      /**
       * A QUEUED write is stored, not failed. Drawing it as an error badge told the person
       * their edit had failed while it sat safely in the outbox — and its Retry button
       * would have enqueued a second copy. Worse, failed mutations are persisted, so the
       * false alarm survived a reload.
       */
      if (snapshot.queued) continue;
      if ((latestBySermon[snapshot.sermonId] ?? -1) > snapshot.submittedAt) continue;
      latestBySermon[snapshot.sermonId] = snapshot.submittedAt;
      syncStatesById[snapshot.sermonId] =
        snapshot.status === 'error'
          ? {
              status: 'error',
              operation: snapshot.operation,
              submissionId: snapshot.submissionId,
              message: snapshot.message ?? t('writeRecovery.sermonFailed'),
              recoveryText: snapshot.recoveryText,
              conflict: snapshot.conflict,
              refused: snapshot.refused,
            }
          : {
              status: 'pending',
              operation: snapshot.operation,
              submissionId: snapshot.submissionId,
            };
    }
  }

  // mutationFn + onMutate/onSuccess/onError come from the defaults registered
  // in mutationDefaults.ts — keeping these bare is what makes a mutation
  // resumed after a reload behave exactly like an in-session one.
  const createMutation = useMutation<Sermon, Error, DashboardSermonCreateVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.create,
  });
  const updateMutation = useMutation<Sermon, Error, DashboardSermonUpdateVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.update,
  });
  const deleteMutation = useMutation<void, Error, DashboardSermonDeleteVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.delete,
  });
  const markMutation = useMutation<Sermon, Error, DashboardSermonMarkVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.markPreached,
  });
  const unmarkMutation = useMutation<Sermon, Error, DashboardSermonUnmarkVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.unmarkPreached,
  });
  const savePreachDateMutation = useMutation<Sermon, Error, DashboardSermonSaveDateVars>({
    mutationKey: DASHBOARD_SERMON_MUTATION_KEYS.savePreachDate,
  });

  const findSermonMutations = useCallback(
    (sermonId: string, status?: 'pending' | 'error') =>
      queryClient
        .getMutationCache()
        .findAll({ mutationKey: [DASHBOARD_SERMON_KEY_PREFIX], exact: false, ...(status ? { status } : {}) })
        .filter((mutation) => sermonIdOf(mutation) === sermonId),
    [queryClient]
  );

  /**
   * Guards against DOUBLE-SUBMIT — the same write fired twice — while a server call is
   * in flight. It must not block a DIFFERENT write: comparing only the sermon id made
   * a second, genuinely new edit resolve as `skipped`, so the editor closed as if
   * accepted and the person's revised text was dropped without a word. The payload
   * fingerprint is what tells "the same write again" from "another edit".
   *
   * Paused (offline-queued) mutations deliberately don't block: further edits queue
   * behind the first and replay in submission order on reconnect.
   */
  const hasSameWriteInFlight = useCallback(
    (sermonId: string, operationKey: string, variables: unknown) => {
      const fingerprint = writeFingerprint(variables);
      return findSermonMutations(sermonId, 'pending').some(
        (mutation) =>
          !mutation.state.isPaused &&
          String(mutation.options.mutationKey?.[1] ?? '') === operationKey &&
          writeFingerprint(mutation.state.variables) === fingerprint
      );
    },
    [findSermonMutations]
  );

  const createSermon = useCallback(
    (input: DashboardCreateSermonInput): WriteSubmission & { sermonId: string } => {
      const uid = resolveUid();
      // No signed-in user: nothing takes this sermon, so the modal must NOT close as if
      // it had. Refusing keeps the title and verse the person typed on screen.
      if (!uid) return { ...refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused')), sermonId: '' };

      // Client-generated id (see clientId.ts): the optimistic row, the POST body
      // and the server doc share one id, so the create is idempotent on replay
      // and callers can navigate to the new sermon's route immediately.
      const sermonId = newClientId();
      const request = createMutation.mutateAsync({
        sermonId,
        uid,
        now: new Date().toISOString(),
        plannedDateId: newClientId(),
        input,
      });
      const createSubmission = submissionForMutation(`sermon:create:${sermonId}`, request);
      // Create-in-series: membership is written through the SAME client playlist
      // sweep as every other membership op (ONE writer of series.items). The
      // server create no longer touches series, so this is what links the sermon.
      const membershipSubmission = input.seriesId
        ? addToSeries(input.seriesId, { type: 'sermon', refId: sermonId })
        : undefined;

      if (!membershipSubmission) {
        return { ...createSubmission, sermonId };
      }

      /**
       * TWO WRITES, TWO FATES — and deliberately NOT one joined acceptance.
       *
       * Joining them looked safer and was not: a refused MEMBERSHIP would then reject
       * the whole submission, the editor would stay open over an ALREADY CREATED
       * sermon, and the person's natural next move — submit again — mints a fresh
       * `sermonId` and creates a DUPLICATE. Membership already owns its own refusal
       * reporting for every surface (useSeriesMembership.ts:399), with a retry that
       * replays the same idempotent sweep, so the person hears about it either way.
       *
       * What genuinely needs joining is the OTHER direction: membership committed
       * while the create was REFUSED leaves the series pointing at a sermon that does
       * not exist. Nothing else would ever clean that up, so this does.
       */
      void createSubmission.persistence.catch(async (error) => {
        // Only a terminal refusal orphans the link. A transient failure may still
        // succeed on replay, and an offline-queued create WILL — undoing membership
        // for either would delete a link the person is about to need.
        if (!isWriteRefusedError(error)) return;
        // WAIT FOR THE LINK TO EXIST BEFORE UNDOING IT. Both operations begin with
        // their own asynchronous read of the series, so an unsequenced removal can
        // read "not linked yet", skip its sweep, and finish BEFORE the add commits —
        // leaving exactly the orphan this cleanup was written to prevent.
        await membershipSubmission.persistence.catch(() => undefined);
        removeFromAllSeries({ type: 'sermon', refId: sermonId });
      });
      void membershipSubmission.acceptance.catch(() => undefined);
      void membershipSubmission.persistence.catch(() => undefined);

      return { ...createSubmission, sermonId };
    },
    [createMutation, addToSeries, removeFromAllSeries]
  );

  const saveEditedSermon = useCallback(
    (input: DashboardEditSermonInput): WriteSubmission => {
      const sermonId = input.sermon.id;
      if (hasSameWriteInFlight(sermonId, 'update', { input })) return skippedWrite();
      return submissionForMutation(
        `sermon:update:${sermonId}`,
        updateMutation.mutateAsync({
          sermonId,
          uid: resolveUid(),
          newPlannedDateId: newClientId(),
          input,
        })
      );
    },
    [hasSameWriteInFlight, updateMutation]
  );

  const deleteSermon = useCallback(
    (sermon: Sermon): WriteSubmission => {
      if (hasSameWriteInFlight(sermon.id, 'delete', undefined)) return skippedWrite();
      return submissionForMutation(
        `sermon:delete:${sermon.id}`,
        deleteMutation.mutateAsync({ sermonId: sermon.id, uid: resolveUid() })
      );
    },
    [deleteMutation, hasSameWriteInFlight]
  );

  const markAsPreachedFromPreferred = useCallback(
    (sermon: Sermon, preferredDate: PreachDate): WriteSubmission => {
      if (hasSameWriteInFlight(sermon.id, 'markPreached', undefined)) return skippedWrite();
      return submissionForMutation(
        `sermon:mark-preached:${sermon.id}`,
        markMutation.mutateAsync({ sermonId: sermon.id, uid: resolveUid(), sermon, preferredDate })
      );
    },
    [hasSameWriteInFlight, markMutation]
  );

  const unmarkAsPreached = useCallback(
    (sermon: Sermon): WriteSubmission => {
      if (hasSameWriteInFlight(sermon.id, 'unmarkPreached', undefined)) return skippedWrite();
      return submissionForMutation(
        `sermon:unmark-preached:${sermon.id}`,
        unmarkMutation.mutateAsync({ sermonId: sermon.id, uid: resolveUid(), sermon })
      );
    },
    [hasSameWriteInFlight, unmarkMutation]
  );

  const savePreachDate = useCallback(
    (
      sermon: Sermon,
      data: PreachDateDraft,
      preachDateToMark: PreachDate | null
    ): WriteSubmission => {
      // A preach date is real typed content, so a DIFFERENT date/church/notes must go
      // through rather than be dropped as a duplicate.
      if (hasSameWriteInFlight(sermon.id, 'savePreachDate', { data })) return skippedWrite();
      return submissionForMutation(
        `sermon:save-preach-date:${sermon.id}`,
        savePreachDateMutation.mutateAsync({
          sermonId: sermon.id,
          uid: resolveUid(),
          sermon,
          data,
          preachDateToMark,
          newPreachDateId: newClientId(),
        })
      );
    },
    [hasSameWriteInFlight, savePreachDateMutation]
  );

  const retrySync = useCallback(
    async (sermonId: string) => {
      const cache = queryClient.getMutationCache();
      const failed = findSermonMutations(sermonId, 'error').sort(
        (a, b) => (a.state.submittedAt ?? 0) - (b.state.submittedAt ?? 0)
      );
      const target = failed[failed.length - 1];
      if (!target) return;

      const operationKey = String(target.options.mutationKey?.[1]);
      let variables = target.state.variables;
      /**
       * A REFUSAL is not a failure to repeat — it is a question already answered.
       *
       * The server turned the write away because the record had moved on, and it said
       * which revision it actually holds. Re-firing the same variables states the same
       * outdated number, so the retry is refused every single time and the only copy of
       * the typed title lives in a mutation record the Dismiss button deletes. Pressing
       * Retry means "send mine anyway", so it aims at the revision the server had.
       */
      if (operationKey === 'update' && isStaleWriteError(target.state.error)) {
        variables = {
          ...(variables as DashboardSermonUpdateVars),
          expectedRevision: target.state.error.actualRevision,
        };
      }
      // Remove the failed entries first so the re-fired mutation is the only
      // badge source for this sermon (mirrors the old single-retry-slot ref).
      failed.forEach((mutation) => cache.remove(mutation));

      const refire: Record<string, () => Promise<unknown>> = {
        create: () => createMutation.mutateAsync(variables as DashboardSermonCreateVars),
        update: () => updateMutation.mutateAsync(variables as DashboardSermonUpdateVars),
        delete: () => deleteMutation.mutateAsync(variables as DashboardSermonDeleteVars),
        markPreached: () => markMutation.mutateAsync(variables as DashboardSermonMarkVars),
        unmarkPreached: () => unmarkMutation.mutateAsync(variables as DashboardSermonUnmarkVars),
        savePreachDate: () => savePreachDateMutation.mutateAsync(variables as DashboardSermonSaveDateVars),
      };
      // Swallow the rejection: a failed retry lands back in the mutation cache
      // as a fresh error badge, which is the feedback channel.
      await refire[operationKey]?.().catch(() => {});
    },
    [
      createMutation,
      deleteMutation,
      findSermonMutations,
      markMutation,
      queryClient,
      savePreachDateMutation,
      unmarkMutation,
      updateMutation,
    ]
  );

  const dismissSyncError = useCallback(
    (sermonId: string) => {
      const cache = queryClient.getMutationCache();
      const all = findSermonMutations(sermonId);
      if (all.some((mutation) => mutation.state.status === 'pending')) return;

      const failed = all.filter((mutation) => mutation.state.status === 'error');
      if (failed.length === 0) return;

      const failedCreate = failed.find(
        (mutation) => String(mutation.options.mutationKey?.[1]) === 'create'
      );
      failed.forEach((mutation) => cache.remove(mutation));

      // A create that never succeeded leaves no server doc, so discard the
      // optimistic row on dismiss.
      if (failedCreate) {
        const uid = (failedCreate.state.variables as DashboardSermonCreateVars).uid;
        queryClient.setQueryData<Sermon[]>(['sermons', uid], (old = []) =>
          old.filter((sermon) => sermon.id !== sermonId)
        );
      }
    },
    [findSermonMutations, queryClient]
  );

  const actions = {
    createSermon,
    saveEditedSermon,
    deleteSermon,
    markAsPreachedFromPreferred,
    unmarkAsPreached,
    savePreachDate,
    retrySync,
    dismissSyncError,
  } as unknown as DashboardOptimisticActions;

  return {
    syncStatesById,
    actions,
  };
}

export default useDashboardOptimisticSermons;
