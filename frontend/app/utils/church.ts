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

/**
 * The congregation a BRAND NEW preach date should carry when the same form also named
 * one for the sermon.
 *
 * Both facts are true at once — "I am preparing this for them" and "this dated event is
 * theirs" — so the date is born with the name instead of the stand-in. Without this the
 * calendar answered "church not specified" for a date the person had just filled in
 * beside the church, in one form, in one keystroke sequence.
 */
export const churchForNewPreachDate = (named?: Church, unspecifiedName?: string): Church =>
  isUnspecifiedChurch(named) ? buildUnspecifiedChurch(unspecifiedName) : (named as Church);

/**
 * What to write onto an EXISTING preach date after the sermon form named a congregation —
 * or `undefined` when it must be left exactly as it is.
 *
 * ONE RULE: fill the unsaid, never overwrite the said. A date that already names a
 * congregation was named deliberately, in Calendar, where a sermon can travel to a
 * different church than the one it was written for; a sermon-level edit has no business
 * rewriting that. A date still holding the stand-in has nobody's decision in it, so the
 * name the person just typed is strictly better than "not specified".
 */
export const churchToFillOnPreachDate = (named?: Church, existing?: Church): Church | undefined =>
  isUnspecifiedChurch(named) || !isUnspecifiedChurch(existing) ? undefined : named;
