import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getNextPlannedDate, getPreachDatesByStatus } from '@/utils/preachDateStatus';
import { auth } from '@services/firebaseAuth.service';
import { addPreachDate, deletePreachDate, updatePreachDate } from '@services/preachDates.service';
import {
  createSermon as createSermonRequest,
  deleteSermon as deleteSermonRequest,
  updateSermon as updateSermonRequest,
} from '@services/sermon.service';

import type {
  DashboardCreateSermonInput,
  DashboardEditSermonInput,
  DashboardOptimisticActions,
  DashboardSermonSyncState,
  PreachDateDraft,
} from '@/models/dashboardOptimistic';
import type { Church, PreachDate, Sermon } from '@/models/models';

const TEMP_SERMON_PREFIX = 'temp-sermon-';
const TEMP_PREACH_DATE_PREFIX = 'temp-preach-date-';
const UNSPECIFIED_CHURCH_ID = 'church-unspecified';
const PREACH_STATUS_OPERATION: DashboardSermonSyncState['operation'] = 'preach-status';
const PREACHED_STATUS_UPDATE_ERROR = 'Failed to update preached status.';

type RetryActionMap = Record<string, () => Promise<void>>;

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

const buildQueryKey = (uid?: string) => ['sermons', uid] as const;

const buildUnspecifiedChurch = (name?: string): Church => ({
  id: UNSPECIFIED_CHURCH_ID,
  name: name?.trim() || 'Church not specified',
  city: '',
});

const buildTempId = (prefix: string) =>
  `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Failed to sync changes. Please retry.';
};

const mergePreachDate = (baseSermon: Sermon, preachDate: PreachDate): Sermon => {
  const preachDates = baseSermon.preachDates || [];
  const existingIndex = preachDates.findIndex((pd) => pd.id === preachDate.id);

  if (existingIndex === -1) {
    return { ...baseSermon, preachDates: [...preachDates, preachDate] };
  }

  const nextPreachDates = [...preachDates];
  nextPreachDates[existingIndex] = preachDate;
  return { ...baseSermon, preachDates: nextPreachDates };
};

export function useDashboardOptimisticSermons(): UseDashboardOptimisticSermonsResult {
  const queryClient = useQueryClient();
  const [syncStatesById, setSyncStatesById] = useState<Record<string, DashboardSermonSyncState>>({});
  const syncStatesRef = useRef(syncStatesById);
  const retryActionsRef = useRef<RetryActionMap>({});

  useEffect(() => {
    syncStatesRef.current = syncStatesById;
  }, [syncStatesById]);

  const mutateSermonCache = useCallback(
    async (mutator: (old: Sermon[]) => Sermon[]) => {
      const uid = resolveUid();
      const queryKey = buildQueryKey(uid);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<Sermon[]>(queryKey, (old) => mutator(old ?? []));
      queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    },
    [queryClient]
  );

  const invalidateCalendarCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['calendarSermons'], exact: false });
  }, [queryClient]);

  const setPendingState = useCallback((sermonId: string, operation: DashboardSermonSyncState['operation']) => {
    setSyncStatesById((prev) => ({
      ...prev,
      [sermonId]: {
        status: 'pending',
        operation,
      },
    }));
  }, []);

  const clearSyncState = useCallback((sermonId: string) => {
    delete retryActionsRef.current[sermonId];
    setSyncStatesById((prev) => {
      if (!prev[sermonId]) return prev;
      const next = { ...prev };
      delete next[sermonId];
      return next;
    });
  }, []);

  const setErrorState = useCallback(
    (
      sermonId: string,
      operation: DashboardSermonSyncState['operation'],
      message: string,
      retryAction: () => Promise<void>
    ) => {
      retryActionsRef.current[sermonId] = retryAction;
      setSyncStatesById((prev) => ({
        ...prev,
        [sermonId]: {
          status: 'error',
          operation,
          message,
        },
      }));
    },
    []
  );

  const dismissSyncError = useCallback(
    (sermonId: string) => {
      const current = syncStatesRef.current[sermonId];
      if (!current || current.status === 'pending') return;

      clearSyncState(sermonId);

      if (current.operation === 'create' && sermonId.startsWith(TEMP_SERMON_PREFIX)) {
        void mutateSermonCache((old) => old.filter((sermon) => sermon.id !== sermonId));
      }
    },
    [clearSyncState, mutateSermonCache]
  );

  const retrySync = useCallback(async (sermonId: string) => {
    const retryAction = retryActionsRef.current[sermonId];
    if (!retryAction) return;
    await retryAction();
  }, []);

  const createSermon = useCallback(
    async (input: DashboardCreateSermonInput) => {
      const uid = resolveUid();
      if (!uid) return;

      const tempId = buildTempId(TEMP_SERMON_PREFIX);
      const now = new Date().toISOString();
      const tempPreachDateId = buildTempId(TEMP_PREACH_DATE_PREFIX);

      const optimisticSermon: Sermon = {
        id: tempId,
        title: input.title,
        verse: input.verse,
        date: now,
        thoughts: [],
        userId: uid,
        seriesId: input.seriesId || undefined,
        preachDates: input.plannedDate
          ? [
              {
                id: tempPreachDateId,
                date: input.plannedDate,
                status: 'planned',
                church: buildUnspecifiedChurch(input.unspecifiedChurchName),
                createdAt: now,
              },
            ]
          : undefined,
      };

      await mutateSermonCache((old) => [optimisticSermon, ...old.filter((sermon) => sermon.id !== tempId)]);
      setPendingState(tempId, 'create');

      const executeCreate = async () => {
        setPendingState(tempId, 'create');
        try {
          const createdSermon = await createSermonRequest({
            title: input.title,
            verse: input.verse,
            date: now,
            thoughts: [],
            userId: uid,
            seriesId: input.seriesId || undefined,
          });

          let persistedSermon = createdSermon;
          if (input.plannedDate) {
            const createdPlannedDate = await addPreachDate(createdSermon.id, {
              date: input.plannedDate,
              status: 'planned',
              church: buildUnspecifiedChurch(input.unspecifiedChurchName),
            });
            persistedSermon = mergePreachDate(createdSermon, createdPlannedDate);
          }

          await mutateSermonCache((old) =>
            old.map((sermon) => (sermon.id === tempId ? persistedSermon : sermon))
          );
          clearSyncState(tempId);
        } catch (error) {
          setErrorState(tempId, 'create', toMessage(error), executeCreate);
        }
      };

      retryActionsRef.current[tempId] = executeCreate;
      void executeCreate();
    },
    [clearSyncState, mutateSermonCache, setErrorState, setPendingState]
  );

  const saveEditedSermon = useCallback(
    async (input: DashboardEditSermonInput) => {
      const { sermon, title, verse, plannedDate, initialPlannedDate, unspecifiedChurchName } = input;
      const sermonId = sermon.id;
      const currentSyncState = syncStatesRef.current[sermonId];
      if (currentSyncState?.status === 'pending') {
        return;
      }

      const existingPlannedDate = getNextPlannedDate(sermon);
      const optimisticPreachDates = [...(sermon.preachDates || [])];

      if (plannedDate !== initialPlannedDate) {
        if (plannedDate) {
          if (existingPlannedDate) {
            const index = optimisticPreachDates.findIndex((pd) => pd.id === existingPlannedDate.id);
            if (index !== -1) {
              optimisticPreachDates[index] = {
                ...optimisticPreachDates[index],
                date: plannedDate,
                status: 'planned',
              };
            }
          } else {
            optimisticPreachDates.push({
              id: buildTempId(TEMP_PREACH_DATE_PREFIX),
              date: plannedDate,
              status: 'planned',
              church: buildUnspecifiedChurch(unspecifiedChurchName),
              createdAt: new Date().toISOString(),
            });
          }
        } else if (existingPlannedDate) {
          const nextDates = optimisticPreachDates.filter((pd) => pd.id !== existingPlannedDate.id);
          optimisticPreachDates.splice(0, optimisticPreachDates.length, ...nextDates);
        }
      }

      const optimisticSermon: Sermon = {
        ...sermon,
        title,
        verse,
        preachDates: optimisticPreachDates,
      };

      await mutateSermonCache((old) =>
        old.map((currentSermon) => (currentSermon.id === sermonId ? optimisticSermon : currentSermon))
      );
      setPendingState(sermonId, 'update');

      const executeUpdate = async () => {
        setPendingState(sermonId, 'update');
        try {
          const updatedSermonBase = await updateSermonRequest({
            ...sermon,
            title,
            verse,
          });

          if (!updatedSermonBase) {
            throw new Error('Failed to update sermon.');
          }

          let persistedSermon = updatedSermonBase;

          if (plannedDate !== initialPlannedDate) {
            if (plannedDate) {
              if (existingPlannedDate) {
                const updatedPlannedDate = await updatePreachDate(sermon.id, existingPlannedDate.id, {
                  date: plannedDate,
                  status: 'planned',
                });
                persistedSermon = mergePreachDate(persistedSermon, updatedPlannedDate);
              } else {
                const createdPlannedDate = await addPreachDate(sermon.id, {
                  date: plannedDate,
                  status: 'planned',
                  church: buildUnspecifiedChurch(unspecifiedChurchName),
                });
                persistedSermon = mergePreachDate(persistedSermon, createdPlannedDate);
              }
            } else if (existingPlannedDate) {
              await deletePreachDate(sermon.id, existingPlannedDate.id);
              persistedSermon = {
                ...persistedSermon,
                preachDates: (persistedSermon.preachDates || []).filter(
                  (preachDate) => preachDate.id !== existingPlannedDate.id
                ),
              };
            }
          }

          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? persistedSermon : currentSermon))
          );
          clearSyncState(sermonId);
        } catch (error) {
          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? sermon : currentSermon))
          );
          setErrorState(sermonId, 'update', toMessage(error), executeUpdate);
        }
      };

      retryActionsRef.current[sermonId] = executeUpdate;
      void executeUpdate();
    },
    [clearSyncState, mutateSermonCache, setErrorState, setPendingState]
  );

  const deleteSermon = useCallback(
    async (sermon: Sermon) => {
      const sermonId = sermon.id;
      const currentSyncState = syncStatesRef.current[sermonId];
      if (currentSyncState?.status === 'pending') {
        return;
      }

      setPendingState(sermonId, 'delete');

      const executeDelete = async () => {
        setPendingState(sermonId, 'delete');
        try {
          await deleteSermonRequest(sermonId);
          await mutateSermonCache((old) => old.filter((currentSermon) => currentSermon.id !== sermonId));
          clearSyncState(sermonId);
        } catch (error) {
          setErrorState(sermonId, 'delete', toMessage(error), executeDelete);
        }
      };

      retryActionsRef.current[sermonId] = executeDelete;
      void executeDelete();
    },
    [clearSyncState, mutateSermonCache, setErrorState, setPendingState]
  );

  const markAsPreachedFromPreferred = useCallback(
    async (sermon: Sermon, preferredDate: PreachDate) => {
      const sermonId = sermon.id;
      const currentSyncState = syncStatesRef.current[sermonId];
      if (currentSyncState?.status === 'pending') {
        return;
      }

      const optimisticSermon: Sermon = {
        ...sermon,
        isPreached: true,
        preachDates: (sermon.preachDates || []).map((preachDate) =>
          preachDate.id === preferredDate.id ? { ...preachDate, status: 'preached' } : preachDate
        ),
      };

      await mutateSermonCache((old) =>
        old.map((currentSermon) => (currentSermon.id === sermonId ? optimisticSermon : currentSermon))
      );
      setPendingState(sermonId, PREACH_STATUS_OPERATION);

      const executeMark = async () => {
        setPendingState(sermonId, PREACH_STATUS_OPERATION);
        try {
          await updatePreachDate(sermon.id, preferredDate.id, { status: 'preached' });
          const updatedSermon = await updateSermonRequest({
            ...sermon,
            isPreached: true,
          });
          if (!updatedSermon) {
            throw new Error(PREACHED_STATUS_UPDATE_ERROR);
          }

          const persistedSermon = mergePreachDate(updatedSermon, {
            ...preferredDate,
            status: 'preached',
          });

          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? persistedSermon : currentSermon))
          );
          clearSyncState(sermonId);
          invalidateCalendarCache();
        } catch (error) {
          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? sermon : currentSermon))
          );
          setErrorState(sermonId, PREACH_STATUS_OPERATION, toMessage(error), executeMark);
        }
      };

      retryActionsRef.current[sermonId] = executeMark;
      void executeMark();
    },
    [clearSyncState, invalidateCalendarCache, mutateSermonCache, setErrorState, setPendingState]
  );

  const unmarkAsPreached = useCallback(
    async (sermon: Sermon) => {
      const sermonId = sermon.id;
      const currentSyncState = syncStatesRef.current[sermonId];
      if (currentSyncState?.status === 'pending') {
        return;
      }

      const preachedDates = getPreachDatesByStatus(sermon, 'preached');
      const optimisticSermon: Sermon = {
        ...sermon,
        isPreached: false,
        preachDates: (sermon.preachDates || []).map((preachDate) =>
          preachDate.status === 'preached' ? { ...preachDate, status: 'planned' } : preachDate
        ),
      };

      await mutateSermonCache((old) =>
        old.map((currentSermon) => (currentSermon.id === sermonId ? optimisticSermon : currentSermon))
      );
      setPendingState(sermonId, PREACH_STATUS_OPERATION);

      const executeUnmark = async () => {
        setPendingState(sermonId, PREACH_STATUS_OPERATION);
        try {
          if (preachedDates.length > 0) {
            await Promise.all(
              preachedDates.map((preachDate) =>
                updatePreachDate(sermon.id, preachDate.id, { status: 'planned' })
              )
            );
          }

          const updatedSermon = await updateSermonRequest({
            ...sermon,
            isPreached: false,
          });

          if (!updatedSermon) {
            throw new Error(PREACHED_STATUS_UPDATE_ERROR);
          }

          const preachedIdSet = new Set(preachedDates.map((preachDate) => preachDate.id));
          const persistedSermon: Sermon = {
            ...updatedSermon,
            preachDates: (updatedSermon.preachDates || []).map((preachDate) =>
              preachedIdSet.has(preachDate.id) ? { ...preachDate, status: 'planned' } : preachDate
            ),
          };

          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? persistedSermon : currentSermon))
          );
          clearSyncState(sermonId);
          invalidateCalendarCache();
        } catch (error) {
          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? sermon : currentSermon))
          );
          setErrorState(sermonId, PREACH_STATUS_OPERATION, toMessage(error), executeUnmark);
        }
      };

      retryActionsRef.current[sermonId] = executeUnmark;
      void executeUnmark();
    },
    [clearSyncState, invalidateCalendarCache, mutateSermonCache, setErrorState, setPendingState]
  );

  const savePreachDate = useCallback(
    async (sermon: Sermon, data: PreachDateDraft, preachDateToMark: PreachDate | null) => {
      const sermonId = sermon.id;
      const currentSyncState = syncStatesRef.current[sermonId];
      if (currentSyncState?.status === 'pending') {
        return;
      }

      const optimisticStatus = data.status || 'preached';
      const optimisticSermon: Sermon = preachDateToMark
        ? {
            ...sermon,
            isPreached: true,
            preachDates: (sermon.preachDates || []).map((preachDate) =>
              preachDate.id === preachDateToMark.id
                ? { ...preachDate, ...data, status: 'preached' }
                : preachDate
            ),
          }
        : {
            ...sermon,
            isPreached: true,
            preachDates: [
              ...(sermon.preachDates || []),
              {
                id: buildTempId(TEMP_PREACH_DATE_PREFIX),
                ...data,
                status: optimisticStatus,
                createdAt: new Date().toISOString(),
              },
            ],
          };

      await mutateSermonCache((old) =>
        old.map((currentSermon) => (currentSermon.id === sermonId ? optimisticSermon : currentSermon))
      );
      setPendingState(sermonId, PREACH_STATUS_OPERATION);

      const executeSavePreachDate = async () => {
        setPendingState(sermonId, PREACH_STATUS_OPERATION);
        try {
          const persistedPreachDate = preachDateToMark
            ? await updatePreachDate(sermon.id, preachDateToMark.id, { ...data, status: 'preached' })
            : await addPreachDate(sermon.id, { ...data, status: optimisticStatus });

          const updatedSermon = await updateSermonRequest({
            ...sermon,
            isPreached: true,
          });

          if (!updatedSermon) {
            throw new Error(PREACHED_STATUS_UPDATE_ERROR);
          }

          const persistedSermon = mergePreachDate(updatedSermon, persistedPreachDate);

          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? persistedSermon : currentSermon))
          );
          clearSyncState(sermonId);
          invalidateCalendarCache();
        } catch (error) {
          await mutateSermonCache((old) =>
            old.map((currentSermon) => (currentSermon.id === sermonId ? sermon : currentSermon))
          );
          setErrorState(sermonId, PREACH_STATUS_OPERATION, toMessage(error), executeSavePreachDate);
        }
      };

      retryActionsRef.current[sermonId] = executeSavePreachDate;
      void executeSavePreachDate();
    },
    [clearSyncState, invalidateCalendarCache, mutateSermonCache, setErrorState, setPendingState]
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
