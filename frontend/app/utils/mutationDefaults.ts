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

import type { Group, PreachDate, PrayerRequest, PrayerStatus, Series, StudyNote, Tag } from '@/models/models';
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
    mutationFn: (payload: Omit<Group, 'id'>) => createGroup(payload),
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
    mutationFn: (payload: Omit<Series, 'id'>) => createSeries(payload),
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
}
