import type { Church } from '@/models/models';

/**
 * The stand-in stored when a preach date is created without anyone naming a church.
 *
 * `PreachDate.church` is required by the model, so a date always carries one; this id is
 * how every reader tells "nobody said" apart from a real congregation. It lived as a bare
 * literal in two unrelated files, which is one rename away from the two copies disagreeing.
 */
export const UNSPECIFIED_CHURCH_ID = 'church-unspecified';

export const buildUnspecifiedChurch = (name?: string): Church => ({
  id: UNSPECIFIED_CHURCH_ID,
  name: name?.trim() || 'Church not specified',
  city: '',
});

/** True for the stand-in above — the one church that must never reach a suggestion list. */
export const isUnspecifiedChurch = (church?: Church | null): boolean =>
  !church || church.id === UNSPECIFIED_CHURCH_ID || !church.name?.trim();
