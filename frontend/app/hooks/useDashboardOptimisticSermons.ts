import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { newClientId } from '@/utils/clientId';
import {
  DASHBOARD_SERMON_KEY_PREFIX,
  DASHBOARD_SERMON_MUTATION_KEYS,
} from '@/utils/mutationDefaults';
import { auth } from '@services/firebaseAuth.service';

import type {
  DashboardCreateSermonInput,
  DashboardEditSermonInput,
  DashboardOptimisticActions,
  DashboardSermonSyncState,
  DashboardSyncOperation,
  PreachDateDraft,
} from '@/models/dashboardOptimistic';
import type { PreachDate, Sermon } from '@/models/models';
import type {
  DashboardSermonCreateVars,
  DashboardSermonDeleteVars,
  DashboardSermonMarkVars,
  DashboardSermonSaveDateVars,
  DashboardSermonUnmarkVars,
  DashboardSermonUpdateVars,
} from '@/utils/mutationDefaults';

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

const FALLBACK_ERROR_MESSAGE = 'Failed to sync changes. Please retry.';

const toMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return FALLBACK_ERROR_MESSAGE;
};

// Structural slice of React Query's Mutation — keeps the helpers usable for
// both useMutationState's select argument and MutationCache.findAll results
// without fighting the Mutation generic's variance.
interface MutationLike {
  options: { mutationKey?: readonly unknown[] };
  state: { variables?: unknown };
}

const sermonIdOf = (mutation: MutationLike): string | undefined =>
  (mutation.state.variables as { sermonId?: string } | undefined)?.sermonId;

const operationOf = (mutation: MutationLike): DashboardSyncOperation | undefined =>
  OPERATION_BY_KEY[String(mutation.options.mutationKey?.[1])];

export function useDashboardOptimisticSermons(): UseDashboardOptimisticSermonsResult {
  const queryClient = useQueryClient();
  const { addToSeries } = useSeriesMembership();

  // The badge map, derived live from the mutation cache: latest pending/error
  // mutation per sermon wins. Successful (and dismissed/removed) mutations
  // simply drop out of the map.
  const badgeSnapshots = useMutationState({
    filters: { mutationKey: [DASHBOARD_SERMON_KEY_PREFIX], exact: false },
    select: (mutation) => ({
      sermonId: sermonIdOf(mutation),
      operation: operationOf(mutation),
      status: mutation.state.status,
      message: mutation.state.error ? toMessage(mutation.state.error) : undefined,
      submittedAt: mutation.state.submittedAt ?? 0,
    }),
  });

  const syncStatesById: Record<string, DashboardSermonSyncState> = {};
  {
    const latestBySermon: Record<string, number> = {};
    for (const snapshot of badgeSnapshots) {
      if (!snapshot.sermonId || !snapshot.operation) continue;
      if (snapshot.status !== 'pending' && snapshot.status !== 'error') continue;
      if ((latestBySermon[snapshot.sermonId] ?? -1) > snapshot.submittedAt) continue;
      latestBySermon[snapshot.sermonId] = snapshot.submittedAt;
      syncStatesById[snapshot.sermonId] =
        snapshot.status === 'error'
          ? { status: 'error', operation: snapshot.operation, message: snapshot.message ?? FALLBACK_ERROR_MESSAGE }
          : { status: 'pending', operation: snapshot.operation };
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

  // Guards against double-submit while a server call is IN FLIGHT. Paused
  // (offline-queued) mutations deliberately don't block: further edits offline
  // queue behind the first and replay in submission order on reconnect.
  const hasActiveInFlight = useCallback(
    (sermonId: string) =>
      findSermonMutations(sermonId, 'pending').some((mutation) => !mutation.state.isPaused),
    [findSermonMutations]
  );

  const createSermon = useCallback(
    async (input: DashboardCreateSermonInput): Promise<string | undefined> => {
      const uid = resolveUid();
      if (!uid) return undefined;

      // Client-generated id (see clientId.ts): the optimistic row, the POST body
      // and the server doc share one id, so the create is idempotent on replay
      // and callers can navigate to the new sermon's route immediately.
      const sermonId = newClientId();
      createMutation.mutate({
        sermonId,
        uid,
        now: new Date().toISOString(),
        plannedDateId: newClientId(),
        input,
      });
      // Create-in-series: membership is written through the SAME client playlist
      // sweep as every other membership op (ONE writer of series.items). The
      // server create no longer touches series, so this is what links the sermon.
      if (input.seriesId) {
        addToSeries(input.seriesId, { type: 'sermon', refId: sermonId });
      }
      return sermonId;
    },
    [createMutation, addToSeries]
  );

  const saveEditedSermon = useCallback(
    async (input: DashboardEditSermonInput) => {
      const sermonId = input.sermon.id;
      if (hasActiveInFlight(sermonId)) return;
      updateMutation.mutate({
        sermonId,
        uid: resolveUid(),
        newPlannedDateId: newClientId(),
        input,
      });
    },
    [hasActiveInFlight, updateMutation]
  );

  const deleteSermon = useCallback(
    async (sermon: Sermon) => {
      if (hasActiveInFlight(sermon.id)) return;
      deleteMutation.mutate({ sermonId: sermon.id, uid: resolveUid() });
    },
    [deleteMutation, hasActiveInFlight]
  );

  const markAsPreachedFromPreferred = useCallback(
    async (sermon: Sermon, preferredDate: PreachDate) => {
      if (hasActiveInFlight(sermon.id)) return;
      markMutation.mutate({ sermonId: sermon.id, uid: resolveUid(), sermon, preferredDate });
    },
    [hasActiveInFlight, markMutation]
  );

  const unmarkAsPreached = useCallback(
    async (sermon: Sermon) => {
      if (hasActiveInFlight(sermon.id)) return;
      unmarkMutation.mutate({ sermonId: sermon.id, uid: resolveUid(), sermon });
    },
    [hasActiveInFlight, unmarkMutation]
  );

  const savePreachDate = useCallback(
    async (sermon: Sermon, data: PreachDateDraft, preachDateToMark: PreachDate | null) => {
      if (hasActiveInFlight(sermon.id)) return;
      savePreachDateMutation.mutate({
        sermonId: sermon.id,
        uid: resolveUid(),
        sermon,
        data,
        preachDateToMark,
        newPreachDateId: newClientId(),
      });
    },
    [hasActiveInFlight, savePreachDateMutation]
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
      const variables = target.state.variables;
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

  const actions: DashboardOptimisticActions = {
    createSermon,
    saveEditedSermon,
    deleteSermon,
    markAsPreachedFromPreferred,
    unmarkAsPreached,
    savePreachDate,
    retrySync,
    dismissSyncError,
  };

  return {
    syncStatesById,
    actions,
  };
}

export default useDashboardOptimisticSermons;
