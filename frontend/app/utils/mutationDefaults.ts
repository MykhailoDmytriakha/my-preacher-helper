import { createGroup, deleteGroup, updateGroup } from '@/services/groups.service';
import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  setPrayerStatus,
  updatePrayerRequest,
} from '@/services/prayerRequests.service';
import { addPreachDate, deletePreachDate, updatePreachDate } from '@/services/preachDates.service';
import { createSeries, deleteSeries, updateSeries } from '@/services/series.service';
import {
  createSermon as createSermonRequest,
  deleteSermon as deleteSermonRequest,
  updateSermon as updateSermonRequest,
} from '@/services/sermon.service';
import { createStudyNote, deleteStudyNote, updateStudyNote } from '@/services/studies.service';
import { createStudyNoteShareLink, deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { addCustomTag, removeCustomTag, updateTag } from '@/services/tag.service';
import {
  updateAudioGenerationAccess,
  updateFirstDayOfWeek,
  updatePrepModeAccess,
  updateShowAppVersion,
  updateStructurePreviewAccess,
} from '@/services/userSettings.service';
import { getNextPlannedDate, getPreachDatesByStatus } from '@/utils/preachDateStatus';

import type {
  DashboardCreateSermonInput,
  DashboardEditSermonInput,
  PreachDateDraft,
} from '@/models/dashboardOptimistic';
import type { Church, Group, PreachDate, PrayerRequest, PrayerStatus, Series, Sermon, StudyNote, Tag } from '@/models/models';
import type { FirstDayOfWeek } from '@/utils/weekStart';
import type { QueryClient } from '@tanstack/react-query';

const USER_SETTINGS_KEY = 'user-settings';
const STUDY_NOTES_KEY = 'study-notes';
const STUDY_NOTE_SHARE_LINKS_KEY = 'study-note-share-links';

/**
 * Stable mutation keys shared between the hooks (where the in-session mutation
 * is defined) and {@link registerOfflineMutationDefaults} (where the resumable
 * default lives). They MUST be identical between the two places — React Query
 * matches a persisted/paused mutation back to its registered `mutationFn` by
 * this key after a reload.
 */
export const GROUP_MUTATION_KEYS = {
  create: ['groups', 'create'] as const,
  update: ['groups', 'update'] as const,
  delete: ['groups', 'delete'] as const,
};

export const SERIES_MUTATION_KEYS = {
  create: ['series', 'create'] as const,
  update: ['series', 'update'] as const,
  delete: ['series', 'delete'] as const,
};

export const PRAYER_MUTATION_KEYS = {
  create: ['prayerRequests', 'create'] as const,
  update: ['prayerRequests', 'update'] as const,
  delete: ['prayerRequests', 'delete'] as const,
  addUpdate: ['prayerRequests', 'addUpdate'] as const,
  status: ['prayerRequests', 'status'] as const,
};

export const TAG_MUTATION_KEYS = {
  add: ['tags', 'add'] as const,
  remove: ['tags', 'remove'] as const,
  update: ['tags', 'update'] as const,
};

export const SETTINGS_MUTATION_KEYS = {
  prepMode: [USER_SETTINGS_KEY, 'prepMode'] as const,
  audioGeneration: [USER_SETTINGS_KEY, 'audioGeneration'] as const,
  structurePreview: [USER_SETTINGS_KEY, 'structurePreview'] as const,
  firstDayOfWeek: [USER_SETTINGS_KEY, 'firstDayOfWeek'] as const,
  showAppVersion: [USER_SETTINGS_KEY, 'showAppVersion'] as const,
};

export const PREACH_DATE_MUTATION_KEYS = {
  add: ['preachDates', 'add'] as const,
  update: ['preachDates', 'update'] as const,
  delete: ['preachDates', 'delete'] as const,
};

export const STUDY_NOTE_MUTATION_KEYS = {
  create: [STUDY_NOTES_KEY, 'create'] as const,
  update: [STUDY_NOTES_KEY, 'update'] as const,
  delete: [STUDY_NOTES_KEY, 'delete'] as const,
};

export const SHARE_LINK_MUTATION_KEYS = {
  create: [STUDY_NOTE_SHARE_LINKS_KEY, 'create'] as const,
  delete: [STUDY_NOTE_SHARE_LINKS_KEY, 'delete'] as const,
};

/**
 * Dashboard sermon operations (create/edit/delete/preach-status). These replaced
 * the hand-rolled retry mechanism in useDashboardOptimisticSermons: every
 * operation is one persisted mutation, so an op made offline pauses, survives a
 * page reload (variables + the optimistic query cache are persisted to
 * IndexedDB) and replays in submission order on reconnect/resume.
 *
 * The shared `'dashboardSermons'` prefix is what useDashboardOptimisticSermons
 * filters on to derive the per-sermon sync badges via useMutationState.
 */
export const DASHBOARD_SERMON_KEY_PREFIX = 'dashboardSermons';

export const DASHBOARD_SERMON_MUTATION_KEYS = {
  create: [DASHBOARD_SERMON_KEY_PREFIX, 'create'] as const,
  update: [DASHBOARD_SERMON_KEY_PREFIX, 'update'] as const,
  delete: [DASHBOARD_SERMON_KEY_PREFIX, 'delete'] as const,
  markPreached: [DASHBOARD_SERMON_KEY_PREFIX, 'markPreached'] as const,
  unmarkPreached: [DASHBOARD_SERMON_KEY_PREFIX, 'unmarkPreached'] as const,
  savePreachDate: [DASHBOARD_SERMON_KEY_PREFIX, 'savePreachDate'] as const,
};

// Variables for the dashboard sermon mutations. Self-contained and
// JSON-serializable (replayable after a reload): every id and timestamp is
// minted by the CALLER and carried here — never inside the mutationFn, where a
// replay would mint fresh ones and break idempotency. `sermonId` is uniform
// across all six shapes so the sync-badge selector can read it blindly;
// `uid` keys the ['sermons', uid] list cache the handlers write to.
export interface DashboardSermonCreateVars {
  sermonId: string;
  uid: string;
  now: string;
  plannedDateId: string;
  input: DashboardCreateSermonInput;
}
export interface DashboardSermonUpdateVars {
  sermonId: string;
  uid: string | undefined;
  newPlannedDateId: string;
  input: DashboardEditSermonInput;
}
export interface DashboardSermonDeleteVars {
  sermonId: string;
  uid: string | undefined;
}
export interface DashboardSermonMarkVars {
  sermonId: string;
  uid: string | undefined;
  sermon: Sermon;
  preferredDate: PreachDate;
}
export interface DashboardSermonUnmarkVars {
  sermonId: string;
  uid: string | undefined;
  sermon: Sermon;
}
export interface DashboardSermonSaveDateVars {
  sermonId: string;
  uid: string | undefined;
  sermon: Sermon;
  data: PreachDateDraft;
  preachDateToMark: PreachDate | null;
  newPreachDateId: string;
}

const PREACHED_STATUS_UPDATE_ERROR = 'Failed to update preached status.';

export const UNSPECIFIED_CHURCH_ID = 'church-unspecified';

export const buildUnspecifiedChurch = (name?: string): Church => ({
  id: UNSPECIFIED_CHURCH_ID,
  name: name?.trim() || 'Church not specified',
  city: '',
});

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

// Deterministically derives the optimistic sermon for an edit from its
// variables alone (no closure state), so onMutate produces the same result on
// the first run and on a manual retry re-fire.
const buildOptimisticEditedSermon = (vars: DashboardSermonUpdateVars): Sermon => {
  const { sermon, title, verse, plannedDate, initialPlannedDate, unspecifiedChurchName } = vars.input;
  const existingPlannedDate = getNextPlannedDate(sermon);
  let preachDates = [...(sermon.preachDates || [])];

  if (plannedDate !== initialPlannedDate) {
    if (plannedDate) {
      if (existingPlannedDate) {
        preachDates = preachDates.map((pd) =>
          pd.id === existingPlannedDate.id ? { ...pd, date: plannedDate, status: 'planned' as const } : pd
        );
      } else {
        preachDates.push({
          id: vars.newPlannedDateId,
          date: plannedDate,
          status: 'planned',
          church: buildUnspecifiedChurch(unspecifiedChurchName),
          createdAt: new Date().toISOString(),
        });
      }
    } else if (existingPlannedDate) {
      preachDates = preachDates.filter((pd) => pd.id !== existingPlannedDate.id);
    }
  }

  return { ...sermon, title, verse, preachDates };
};

// Variable shapes carried by each mutation. They MUST be self-contained (no
// closure state) so a mutation rehydrated from IndexedDB after a reload can be
// replayed by the registered mutationFn alone.
type TagRemoveVars = { userId: string; tagName: string };
type SettingVars = { userId: string; value: boolean };
type FirstDayVars = { userId: string; value: FirstDayOfWeek };

/**
 * Why this exists (offline write buffer):
 *
 * React Query persists paused/error mutations to IndexedDB and calls
 * `resumePausedMutations()` on reload. But a persisted mutation only carries
 * its `mutationKey` + serialized `variables` — the in-memory `mutationFn`
 * closure from `useMutation` is gone after a full page reload. Without a
 * `mutationFn` registered against that key, `resume` is a silent no-op and the
 * offline write is lost.
 *
 * `setMutationDefaults(key, { mutationFn })` registers the function to call for
 * any mutation with that key — including ones rehydrated from IndexedDB after a
 * reload. `onSuccess` re-fetches the authoritative server list so any optimistic
 * placeholder is reconciled with the real record.
 *
 * Call this once, against the same QueryClient that PersistQueryClientProvider
 * uses, before mutations can be resumed.
 */
export function registerOfflineMutationDefaults(queryClient: QueryClient) {
  const invalidate = (queryKey: readonly unknown[]) => () =>
    queryClient.invalidateQueries({ queryKey });

  // ---- groups ----
  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.create, {
    mutationFn: (payload: Omit<Group, 'id'> & { id?: string }) => createGroup(payload),
    onSuccess: invalidate(['groups']),
  });
  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.update, {
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group> }) => updateGroup(id, updates),
    onSuccess: invalidate(['groups']),
  });
  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.delete, {
    mutationFn: (groupId: string) => deleteGroup(groupId),
    onSuccess: invalidate(['groups']),
  });

  // ---- series ----
  queryClient.setMutationDefaults(SERIES_MUTATION_KEYS.create, {
    mutationFn: (payload: Omit<Series, 'id'> & { id?: string }) => createSeries(payload),
    onSuccess: invalidate(['series']),
  });
  queryClient.setMutationDefaults(SERIES_MUTATION_KEYS.update, {
    mutationFn: ({ seriesId, updates }: { seriesId: string; updates: Partial<Series> }) =>
      updateSeries(seriesId, updates),
    onSuccess: invalidate(['series']),
  });
  queryClient.setMutationDefaults(SERIES_MUTATION_KEYS.delete, {
    mutationFn: (seriesId: string) => deleteSeries(seriesId),
    onSuccess: invalidate(['series']),
  });

  // ---- prayer requests ----
  queryClient.setMutationDefaults(PRAYER_MUTATION_KEYS.create, {
    mutationFn: (payload: Pick<PrayerRequest, 'userId' | 'title'> &
      Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>> & { id?: string }) =>
      createPrayerRequest(payload),
    onSuccess: invalidate(['prayerRequests']),
  });
  queryClient.setMutationDefaults(PRAYER_MUTATION_KEYS.update, {
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PrayerRequest> }) =>
      updatePrayerRequest(id, updates),
    onSuccess: invalidate(['prayerRequests']),
  });
  queryClient.setMutationDefaults(PRAYER_MUTATION_KEYS.delete, {
    mutationFn: (id: string) => deletePrayerRequest(id),
    onSuccess: invalidate(['prayerRequests']),
  });
  queryClient.setMutationDefaults(PRAYER_MUTATION_KEYS.addUpdate, {
    mutationFn: ({ id, text }: { id: string; text: string }) => addPrayerUpdate(id, text),
    onSuccess: invalidate(['prayerRequests']),
  });
  queryClient.setMutationDefaults(PRAYER_MUTATION_KEYS.status, {
    mutationFn: ({ id, status, answerText }: { id: string; status: PrayerStatus; answerText?: string }) =>
      setPrayerStatus(id, status, answerText),
    onSuccess: invalidate(['prayerRequests']),
  });

  // ---- tags ----
  queryClient.setMutationDefaults(TAG_MUTATION_KEYS.add, {
    mutationFn: (tag: Tag) => addCustomTag(tag),
    onSuccess: invalidate(['tags']),
  });
  queryClient.setMutationDefaults(TAG_MUTATION_KEYS.remove, {
    mutationFn: ({ userId, tagName }: TagRemoveVars) => removeCustomTag(userId, tagName),
    onSuccess: invalidate(['tags']),
  });
  queryClient.setMutationDefaults(TAG_MUTATION_KEYS.update, {
    mutationFn: (tag: Tag) => updateTag(tag),
    onSuccess: invalidate(['tags']),
  });

  // ---- user settings ----
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.prepMode, {
    mutationFn: ({ userId, value }: SettingVars) => updatePrepModeAccess(userId, value),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.audioGeneration, {
    mutationFn: ({ userId, value }: SettingVars) => updateAudioGenerationAccess(userId, value),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.structurePreview, {
    mutationFn: ({ userId, value }: SettingVars) => updateStructurePreviewAccess(userId, value),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.firstDayOfWeek, {
    mutationFn: ({ userId, value }: FirstDayVars) => updateFirstDayOfWeek(userId, value),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.showAppVersion, {
    mutationFn: ({ userId, value }: SettingVars) => updateShowAppVersion(userId, value),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });

  // ---- preach dates (sermon-scoped) ----
  const invalidatePreachDates = () => {
    queryClient.invalidateQueries({ queryKey: ['preachDates'] });
    queryClient.invalidateQueries({ queryKey: ['sermons'] });
  };
  queryClient.setMutationDefaults(PREACH_DATE_MUTATION_KEYS.add, {
    mutationFn: ({ sermonId, data }: { sermonId: string; data: Omit<PreachDate, 'id' | 'createdAt'> }) =>
      addPreachDate(sermonId, data),
    onSuccess: invalidatePreachDates,
  });
  queryClient.setMutationDefaults(PREACH_DATE_MUTATION_KEYS.update, {
    mutationFn: ({ sermonId, dateId, updates }: { sermonId: string; dateId: string; updates: Partial<PreachDate> }) =>
      updatePreachDate(sermonId, dateId, updates),
    onSuccess: invalidatePreachDates,
  });
  queryClient.setMutationDefaults(PREACH_DATE_MUTATION_KEYS.delete, {
    mutationFn: ({ sermonId, dateId }: { sermonId: string; dateId: string }) =>
      deletePreachDate(sermonId, dateId),
    onSuccess: invalidatePreachDates,
  });

  // ---- study notes ----
  queryClient.setMutationDefaults(STUDY_NOTE_MUTATION_KEYS.create, {
    mutationFn: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'> & { id?: string }) =>
      createStudyNote(note),
    onSuccess: invalidate([STUDY_NOTES_KEY]),
  });
  queryClient.setMutationDefaults(STUDY_NOTE_MUTATION_KEYS.update, {
    mutationFn: ({ id, updates, userId }: { id: string; updates: Partial<StudyNote>; userId: string }) =>
      updateStudyNote(id, { ...updates, userId }),
    onSuccess: invalidate([STUDY_NOTES_KEY]),
  });
  queryClient.setMutationDefaults(STUDY_NOTE_MUTATION_KEYS.delete, {
    mutationFn: ({ id, userId }: { id: string; userId: string }) => deleteStudyNote(id, userId),
    onSuccess: invalidate([STUDY_NOTES_KEY]),
  });

  // ---- study-note share links ----
  queryClient.setMutationDefaults(SHARE_LINK_MUTATION_KEYS.create, {
    mutationFn: ({ userId, noteId }: { userId: string; noteId: string }) =>
      createStudyNoteShareLink(userId, noteId),
    onSuccess: invalidate([STUDY_NOTE_SHARE_LINKS_KEY]),
  });
  queryClient.setMutationDefaults(SHARE_LINK_MUTATION_KEYS.delete, {
    mutationFn: ({ userId, linkId }: { userId: string; linkId: string }) =>
      deleteStudyNoteShareLink(userId, linkId),
    onSuccess: invalidate([STUDY_NOTE_SHARE_LINKS_KEY]),
  });

  // ---- dashboard sermons (one persisted mutation per user-level operation) ----
  //
  // ALL handlers (onMutate/onSuccess/onError) live HERE, not in the hook: a
  // mutation resumed after a reload only sees these defaults, so keeping the
  // hook bare makes in-session and post-reload behavior identical by
  // construction. Rollback material comes from the variables (never from
  // onMutate context — context does not survive a reload). The multi-step
  // mutationFns re-run from the top on replay; every sub-step is idempotent
  // (client-id create, upsert-by-id preach dates, full-body PUT, delete-by-id).

  const writeSermons = async (uid: string | undefined, mutator: (old: Sermon[]) => Sermon[]) => {
    const queryKey = ['sermons', uid] as const;
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<Sermon[]>(queryKey, (old) => mutator(old ?? []));
    queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  };

  const invalidateCalendar = () => {
    queryClient.invalidateQueries({ queryKey: ['calendarSermons'], exact: false });
  };

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.create, {
    mutationFn: async (vars: DashboardSermonCreateVars): Promise<Sermon> => {
      const { sermonId, uid, now, plannedDateId, input } = vars;
      const created = await createSermonRequest({
        id: sermonId,
        title: input.title,
        verse: input.verse,
        date: now,
        thoughts: [],
        userId: uid,
        seriesId: input.seriesId || undefined,
      });

      if (!input.plannedDate) {
        return created;
      }

      // Same id as the optimistic row's planned date -> a replayed create
      // upserts instead of duplicating.
      const createdPlannedDate = await addPreachDate(created.id, {
        id: plannedDateId,
        date: input.plannedDate,
        status: 'planned',
        church: buildUnspecifiedChurch(input.unspecifiedChurchName),
      });
      return mergePreachDate(created, createdPlannedDate);
    },
    onMutate: async (vars: DashboardSermonCreateVars) => {
      const { sermonId, uid, now, plannedDateId, input } = vars;
      const optimisticSermon: Sermon = {
        id: sermonId,
        title: input.title,
        verse: input.verse,
        date: now,
        thoughts: [],
        userId: uid,
        seriesId: input.seriesId || undefined,
        preachDates: input.plannedDate
          ? [
              {
                id: plannedDateId,
                date: input.plannedDate,
                status: 'planned',
                church: buildUnspecifiedChurch(input.unspecifiedChurchName),
                createdAt: now,
              },
            ]
          : undefined,
      };
      await writeSermons(uid, (old) => [optimisticSermon, ...old.filter((s) => s.id !== sermonId)]);
    },
    onSuccess: async (persisted: Sermon, vars: DashboardSermonCreateVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? persisted : s)));
    },
    // onError: keep the optimistic row — the error badge offers Retry, and
    // Dismiss is what discards an unsynced create (mirrors the old mechanism).
  });

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.update, {
    mutationFn: async (vars: DashboardSermonUpdateVars): Promise<Sermon> => {
      const { input, newPlannedDateId } = vars;
      const { sermon, title, verse, plannedDate, initialPlannedDate, unspecifiedChurchName } = input;
      const existingPlannedDate = getNextPlannedDate(sermon);

      const updatedBase = await updateSermonRequest({ ...sermon, title, verse });
      if (!updatedBase) {
        throw new Error('Failed to update sermon.');
      }

      let persisted = updatedBase;
      if (plannedDate !== initialPlannedDate) {
        if (plannedDate) {
          if (existingPlannedDate) {
            const updatedPlannedDate = await updatePreachDate(sermon.id, existingPlannedDate.id, {
              date: plannedDate,
              status: 'planned',
            });
            persisted = mergePreachDate(persisted, updatedPlannedDate);
          } else {
            const createdPlannedDate = await addPreachDate(sermon.id, {
              id: newPlannedDateId,
              date: plannedDate,
              status: 'planned',
              church: buildUnspecifiedChurch(unspecifiedChurchName),
            });
            persisted = mergePreachDate(persisted, createdPlannedDate);
          }
        } else if (existingPlannedDate) {
          await deletePreachDate(sermon.id, existingPlannedDate.id);
          persisted = {
            ...persisted,
            preachDates: (persisted.preachDates || []).filter((pd) => pd.id !== existingPlannedDate.id),
          };
        }
      }
      return persisted;
    },
    onMutate: async (vars: DashboardSermonUpdateVars) => {
      const optimisticSermon = buildOptimisticEditedSermon(vars);
      await writeSermons(vars.uid, (old) =>
        old.map((s) => (s.id === vars.sermonId ? optimisticSermon : s))
      );
    },
    onSuccess: async (persisted: Sermon, vars: DashboardSermonUpdateVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? persisted : s)));
    },
    onError: async (_error: unknown, vars: DashboardSermonUpdateVars) => {
      await writeSermons(vars.uid, (old) =>
        old.map((s) => (s.id === vars.sermonId ? vars.input.sermon : s))
      );
    },
  });

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.delete, {
    mutationFn: async (vars: DashboardSermonDeleteVars): Promise<void> => {
      await deleteSermonRequest(vars.sermonId);
    },
    // No onMutate: the row stays until the server confirms (mirrors the old
    // mechanism — a failed delete must not make the sermon vanish).
    onSuccess: async (_data: void, vars: DashboardSermonDeleteVars) => {
      await writeSermons(vars.uid, (old) => old.filter((s) => s.id !== vars.sermonId));
    },
  });

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.markPreached, {
    mutationFn: async (vars: DashboardSermonMarkVars): Promise<Sermon> => {
      const { sermon, preferredDate } = vars;
      await updatePreachDate(sermon.id, preferredDate.id, { status: 'preached' });
      const updatedSermon = await updateSermonRequest({ ...sermon, isPreached: true });
      if (!updatedSermon) {
        throw new Error(PREACHED_STATUS_UPDATE_ERROR);
      }
      return mergePreachDate(updatedSermon, { ...preferredDate, status: 'preached' });
    },
    onMutate: async (vars: DashboardSermonMarkVars) => {
      const optimisticSermon: Sermon = {
        ...vars.sermon,
        isPreached: true,
        preachDates: (vars.sermon.preachDates || []).map((pd) =>
          pd.id === vars.preferredDate.id ? { ...pd, status: 'preached' as const } : pd
        ),
      };
      await writeSermons(vars.uid, (old) =>
        old.map((s) => (s.id === vars.sermonId ? optimisticSermon : s))
      );
    },
    onSuccess: async (persisted: Sermon, vars: DashboardSermonMarkVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? persisted : s)));
      invalidateCalendar();
    },
    onError: async (_error: unknown, vars: DashboardSermonMarkVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? vars.sermon : s)));
    },
  });

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.unmarkPreached, {
    mutationFn: async (vars: DashboardSermonUnmarkVars): Promise<Sermon> => {
      const { sermon } = vars;
      const preachedDates = getPreachDatesByStatus(sermon, 'preached');
      if (preachedDates.length > 0) {
        await Promise.all(
          preachedDates.map((pd) => updatePreachDate(sermon.id, pd.id, { status: 'planned' }))
        );
      }

      const updatedSermon = await updateSermonRequest({ ...sermon, isPreached: false });
      if (!updatedSermon) {
        throw new Error(PREACHED_STATUS_UPDATE_ERROR);
      }

      const preachedIdSet = new Set(preachedDates.map((pd) => pd.id));
      return {
        ...updatedSermon,
        preachDates: (updatedSermon.preachDates || []).map((pd) =>
          preachedIdSet.has(pd.id) ? { ...pd, status: 'planned' as const } : pd
        ),
      };
    },
    onMutate: async (vars: DashboardSermonUnmarkVars) => {
      const optimisticSermon: Sermon = {
        ...vars.sermon,
        isPreached: false,
        preachDates: (vars.sermon.preachDates || []).map((pd) =>
          pd.status === 'preached' ? { ...pd, status: 'planned' as const } : pd
        ),
      };
      await writeSermons(vars.uid, (old) =>
        old.map((s) => (s.id === vars.sermonId ? optimisticSermon : s))
      );
    },
    onSuccess: async (persisted: Sermon, vars: DashboardSermonUnmarkVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? persisted : s)));
      invalidateCalendar();
    },
    onError: async (_error: unknown, vars: DashboardSermonUnmarkVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? vars.sermon : s)));
    },
  });

  queryClient.setMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.savePreachDate, {
    mutationFn: async (vars: DashboardSermonSaveDateVars): Promise<Sermon> => {
      const { sermon, data, preachDateToMark, newPreachDateId } = vars;
      const persistedPreachDate = preachDateToMark
        ? await updatePreachDate(sermon.id, preachDateToMark.id, { ...data, status: 'preached' })
        : await addPreachDate(sermon.id, { id: newPreachDateId, ...data, status: data.status || 'preached' });

      const updatedSermon = await updateSermonRequest({ ...sermon, isPreached: true });
      if (!updatedSermon) {
        throw new Error(PREACHED_STATUS_UPDATE_ERROR);
      }
      return mergePreachDate(updatedSermon, persistedPreachDate);
    },
    onMutate: async (vars: DashboardSermonSaveDateVars) => {
      const { sermon, data, preachDateToMark, newPreachDateId } = vars;
      const optimisticSermon: Sermon = preachDateToMark
        ? {
            ...sermon,
            isPreached: true,
            preachDates: (sermon.preachDates || []).map((pd) =>
              pd.id === preachDateToMark.id ? { ...pd, ...data, status: 'preached' as const } : pd
            ),
          }
        : {
            ...sermon,
            isPreached: true,
            preachDates: [
              ...(sermon.preachDates || []),
              {
                id: newPreachDateId,
                ...data,
                status: data.status || 'preached',
                createdAt: new Date().toISOString(),
              },
            ],
          };
      await writeSermons(vars.uid, (old) =>
        old.map((s) => (s.id === vars.sermonId ? optimisticSermon : s))
      );
    },
    onSuccess: async (persisted: Sermon, vars: DashboardSermonSaveDateVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? persisted : s)));
      invalidateCalendar();
    },
    onError: async (_error: unknown, vars: DashboardSermonSaveDateVars) => {
      await writeSermons(vars.uid, (old) => old.map((s) => (s.id === vars.sermonId ? vars.sermon : s)));
    },
  });
}
