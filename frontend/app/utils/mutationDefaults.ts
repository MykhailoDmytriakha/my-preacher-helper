import { assertLegacyClientWriteAllowed } from '@/data-engine/clientPolicy';
import { createStudyNoteShareLink, deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import {
  updateAudioGenerationAccess,
  updateFirstDayOfWeek,
  updateFunctionModelPreference,
  updateModelPreference,
  updatePrepModeAccess,
  updateShowAppVersion,
  updateStructurePreviewAccess,
} from '@/services/userSettings.service';

import type { ModelPreference } from '@/services/userSettings.service';
import type { FunctionModelPreference } from '@/services/userSettings.service';
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

/**
 * A collection the engine owns refuses a replayed legacy mutation with the same `data-engine-required`
 * error its old writer threw first; nothing is written and the text stays in the migration archive.
 */
const refuseLegacyReplay = (collection: string) => async (): Promise<never> => {
  assertLegacyClientWriteAllowed(collection);
  throw new Error(`${collection} is written only through the data engine`);
};

export const PLAN_TEMPLATE_MUTATION_KEYS = {
  create: ['planTemplates', 'create'] as const,
  update: ['planTemplates', 'update'] as const,
  delete: ['planTemplates', 'delete'] as const,
};

export const SETTINGS_MUTATION_KEYS = {
  prepMode: [USER_SETTINGS_KEY, 'prepMode'] as const,
  audioGeneration: [USER_SETTINGS_KEY, 'audioGeneration'] as const,
  structurePreview: [USER_SETTINGS_KEY, 'structurePreview'] as const,
  firstDayOfWeek: [USER_SETTINGS_KEY, 'firstDayOfWeek'] as const,
  showAppVersion: [USER_SETTINGS_KEY, 'showAppVersion'] as const,
  modelPreference: [USER_SETTINGS_KEY, 'modelPreference'] as const,
  functionModelPreference: [USER_SETTINGS_KEY, 'functionModelPreference'] as const,
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
 * Sermon operations the previous version queued from the dashboard, the calendar and the
 * preach-date list. The keys stay registered so a paused one resumes into a refusal.
 */
export const DASHBOARD_SERMON_MUTATION_KEYS = {
  create: ['dashboardSermons', 'create'] as const,
  update: ['dashboardSermons', 'update'] as const,
  delete: ['dashboardSermons', 'delete'] as const,
  markPreached: ['dashboardSermons', 'markPreached'] as const,
  unmarkPreached: ['dashboardSermons', 'unmarkPreached'] as const,
  savePreachDate: ['dashboardSermons', 'savePreachDate'] as const,
};

// Variable shapes carried by each mutation. They MUST be self-contained (no
// closure state) so a mutation rehydrated from IndexedDB after a reload can be
// replayed by the registered mutationFn alone.
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
  // The engine owns groups; a paused edit of the previous version gets the same refusal, and its
  // text survives in the previous-version archive (legacyQueryRecovery.client.ts).
  for (const key of Object.values(GROUP_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('groups') });
  }

  // ---- series ----
  // The engine owns series; a paused edit of the previous version gets the same refusal, and its
  // text survives in the previous-version archive (legacyQueryRecovery.client.ts).
  for (const key of Object.values(SERIES_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('series') });
  }

  // ---- prayer requests ----
  // The engine owns prayer requests; a paused edit of the previous version gets the same refusal,
  // and its text survives in the previous-version archive (legacyQueryRecovery.client.ts).
  for (const key of Object.values(PRAYER_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('prayerRequests') });
  }

  // ---- tags ----
  // The engine owns tags; a paused edit of the previous version gets the same refusal.
  for (const key of Object.values(TAG_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('tags') });
  }

  // ---- plan templates ----
  // The engine owns plan templates. A paused edit of the previous version replays into the
  // same refusal its old writer gave; the migration archive keeps its text for the person.
  for (const key of Object.values(PLAN_TEMPLATE_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('planTemplates') });
  }

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
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.modelPreference, {
    mutationFn: ({ userId, preference }: { userId: string; preference: ModelPreference }) =>
      updateModelPreference(userId, preference),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });
  queryClient.setMutationDefaults(SETTINGS_MUTATION_KEYS.functionModelPreference, {
    mutationFn: ({ userId, preference }: { userId: string; preference: FunctionModelPreference }) =>
      updateFunctionModelPreference(userId, preference),
    onSuccess: invalidate([USER_SETTINGS_KEY]),
  });

  // ---- study notes ----
  // The engine owns study notes; a paused edit of the previous version gets the same refusal, and
  // its text survives in the previous-version archive (legacyQueryRecovery.client.ts).
  for (const key of Object.values(STUDY_NOTE_MUTATION_KEYS)) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('studyNotes') });
  }

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

  // ---- sermons ----
  // The engine owns sermons; a paused edit of the previous version gets the same refusal, and its
  // text survives in the previous-version archive (legacyQueryRecovery.client.ts).
  for (const key of [...Object.values(DASHBOARD_SERMON_MUTATION_KEYS), ...Object.values(PREACH_DATE_MUTATION_KEYS)]) {
    queryClient.setMutationDefaults(key, { mutationFn: refuseLegacyReplay('sermons') });
  }
}
