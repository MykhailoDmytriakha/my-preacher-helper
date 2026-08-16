import { contentFingerprint } from '@/utils/contentFingerprint';
import { readPlanText } from '@/utils/planText';

import type { Sermon } from '@/models/models';

/**
 * What is actually compared when deciding "this sermon was edited elsewhere".
 *
 * ONE function for BOTH sides of the comparison — what the screen holds and what
 * the server sent. This used to be written twice inside the sermon page, once as
 * `known` and once as `select`. Two copies of one rule drift apart silently, and
 * the drift then looks exactly like a foreign edit: the duplication becomes the
 * very defect the rule exists to detect.
 */
export type SermonFreshnessProjection = {
  title: string;
  verse: string;
  thoughts: string;
  outline: string;
  plan: string;
  planText: string;
  preparation: string;
  scratch: string;
};

type SermonLike = Record<string, unknown>;

/**
 * Thoughts are compared by CONTENT, not by position.
 *
 * Firestore appends a new thought to the end of the array (`arrayUnion`) while the
 * screen inserts it at the front, so the very same content sits in a different
 * order on the two sides. Comparing position reported that as a foreign edit, and
 * the preacher got "changed on another device" after EVERY thought he recorded
 * himself. Such fingerprints could never converge again, which is why the banner
 * never went away on its own.
 *
 * Array position carries no user-visible meaning for thoughts: the list on screen
 * is sorted by date anyway. Outline and plan are different — there the order of
 * points IS the meaning, and reordering must stay visible. Hence only thoughts are
 * canonicalised here, and `contentFingerprint` itself stays order-sensitive.
 */
function stableKey(value: unknown): string {
  // The WHOLE item, not a few chosen fields: two legacy entries sharing an id, a
  // date and a text but differing elsewhere would otherwise compare equal, the sort
  // would leave them as they came, and the comparison would quietly go back to
  // depending on position.
  return contentFingerprint(value);
}

function canonicalOrder(value: unknown): unknown {
  if (!Array.isArray(value)) return value ?? [];
  return [...value].sort((a, b) => {
    const keyA = stableKey(a);
    const keyB = stableKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

/**
 * Compare the plan text the application READS, not the raw field that happens to store it.
 *
 * During the transition the same readable plan has several valid storage shapes:
 * - before migration, text exists only in `plan.<section>.outlinePoints`;
 * - migration copies it into `planText` but deliberately leaves the legacy backup in place;
 * - a leaf save may leave Firestore with a sparse `planText`, while the screen mirrors the
 *   fully merged old+new map into its sermon object.
 *
 * Fingerprinting raw `planText` calls those representation differences foreign edits. Both
 * screens already render through `readPlanText`, so that merged map is the canonical value:
 * storage-only moves compare equal, while changing a node's effective text still differs.
 */
function effectivePlanTextFingerprint(data: SermonLike): string {
  return contentFingerprint(readPlanText(data as unknown as Sermon));
}

export function sermonFreshnessProjection(data: SermonLike): SermonFreshnessProjection {
  return {
    title: (data.title as string) || '',
    verse: (data.verse as string) || '',
    thoughts: contentFingerprint(canonicalOrder(data.thoughts)),
    outline: contentFingerprint(data.outline ?? null),
    plan: contentFingerprint(data.plan ?? data.draft ?? null),
    planText: effectivePlanTextFingerprint(data),
    preparation: contentFingerprint(data.preparation ?? null),
    scratch: contentFingerprint(canonicalOrder(data.scratch)),
  };
}

/**
 * The plan screen watches the SAME sermon document, only fewer of its fields.
 *
 * It lives here rather than in the plan page for one reason: the rule for
 * comparing thoughts must exist in exactly one place. The plan screen had its own
 * copy and carried the same defect — a thought added on the sermon screen lands at
 * the front of the cached array while the server holds it at the end, so opening
 * the plan raised "changed on another device" about the person's own writing.
 */
export type PlanFreshnessProjection = {
  outline: string;
  plan: string;
  planText: string;
  thoughts: string;
};

export function planFreshnessProjection(data: SermonLike): PlanFreshnessProjection {
  return {
    outline: contentFingerprint(data.outline ?? null),
    plan: contentFingerprint(data.plan ?? data.draft ?? null),
    planText: effectivePlanTextFingerprint(data),
    thoughts: contentFingerprint(canonicalOrder(data.thoughts)),
  };
}
