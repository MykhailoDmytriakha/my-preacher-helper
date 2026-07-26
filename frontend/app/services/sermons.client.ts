import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  type FieldValue,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import {
  PreachDate,
  Preparation,
  ScratchNote,
  Sermon,
  SermonOutline,
  Thought,
  ThoughtsBySection,
} from '@/models/models';
import { atomicUpdate } from '@/services/atomicUpdate.client';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';
import { newClientId } from '@/utils/clientId';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { compareById, timeOrZero } from '@/utils/sortHelpers';
import { stripStructureTags } from '@/utils/thoughtTagSanitizer';

// Sermon READS + own-doc WRITES (update fields, structure, outline, thoughts[],
// preachDates[]) go through the client Firestore SDK unconditionally (offline
// replica + deployed Security Rules). Operations that need secrets (AI:
// transcription/insights/plan/brainstorm/TTS) or cascade into OTHER collections
// (delete -> series delete-cleanup) stay on the server. Series MEMBERSHIP is not
// a cascade anymore: it lives in series.items and is written by the client
// playlist sweep (useSeriesMembership). The Phase 5 cleanup removed the last
// consumer of the old NEXT_PUBLIC_USE_CLIENT_SERMONS strangler-fig flag, so the
// client path is no longer gated.

const SERMONS_COLLECTION = 'sermons';
const SERMON_NOT_FOUND = 'Sermon not found';
// Prefix historically used for not-yet-saved local thought ids. Keep stripping
// it as a defensive migration backstop so saved thoughts read as real ids.
const LOCAL_OPTIMISTIC_ID_PREFIX = 'local-';

// Firestore's updateDoc payload type: any field may hold a value or a FieldValue
// sentinel (arrayUnion). Matches the shape updateDoc accepts for untyped docs.
type SermonUpdate = { [key: string]: FieldValue | Partial<unknown> | undefined };

const now = () => new Date().toISOString();

function db() {
  return getClientDb();
}

function sermonRef(id: string) {
  return doc(db(), SERMONS_COLLECTION, id);
}

/** Firestore rejects `undefined` values; drop them recursively before writing. */
function deepCleanUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepCleanUndefined(item)) as T;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deepCleanUndefined(v)])
    ) as T;
  }
  return value;
}

/**
 * Mirrors the server hydration (sermons.repository.fetchSermonById): keep the
 * modern field and its legacy alias in sync so consumers see the same shape
 * whether the doc stored `thoughtsBySection`/`structure` or `draft`/`plan`.
 */
export function hydrateSermon(raw: Sermon): Sermon {
  const sermon: Sermon = { ...raw };

  const hydratedStructure = raw.thoughtsBySection || raw.structure;
  if (hydratedStructure) {
    sermon.thoughtsBySection = hydratedStructure;
    sermon.structure = raw.structure || hydratedStructure;
  }

  const hydratedDraft = raw.draft || raw.plan;
  if (hydratedDraft) {
    sermon.draft = hydratedDraft;
    sermon.plan = raw.plan || hydratedDraft;
  }

  return sermon;
}

function sortSermons(sermons: Sermon[]): Sermon[] {
  return [...sermons].sort((a, b) => {
    const byDate = timeOrZero(b.date) - timeOrZero(a.date);
    if (byDate !== 0) return byDate;
    return compareById(a, b);
  });
}

// --- READS ---

export async function getSermonsViaClient(userId: string): Promise<Sermon[]> {
  const snap = await getDocs(
    query(collection(db(), SERMONS_COLLECTION), where('userId', '==', userId))
  );
  const sermons = snap.docs.map((d) => hydrateSermon({ ...(d.data() as Sermon), id: d.id }));
  return sortSermons(sermons);
}

export async function getSermonByIdViaClient(id: string): Promise<Sermon | undefined> {
  const snap = await getDoc(sermonRef(id));
  if (!snap.exists()) return undefined;
  return hydrateSermon({ ...(snap.data() as Sermon), id: snap.id });
}

export async function getSermonOutlineViaClient(
  sermonId: string
): Promise<SermonOutline | undefined> {
  const snap = await getDoc(sermonRef(sermonId));
  if (!snap.exists()) return undefined;
  const sermon = snap.data() as Sermon;
  // Server returns `sermon.outline || {}` for an existing sermon with no outline.
  return (sermon.outline || {}) as SermonOutline;
}

export async function fetchPreachDatesViaClient(sermonId: string): Promise<PreachDate[]> {
  const snap = await getDoc(sermonRef(sermonId));
  if (!snap.exists()) return [];
  return (snap.data() as Sermon).preachDates || [];
}

export async function fetchCalendarSermonsViaClient(
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Sermon[]> {
  const snap = await getDocs(
    query(collection(db(), SERMONS_COLLECTION), where('userId', '==', userId))
  );
  let sermons = snap.docs.map((d) => hydrateSermon({ ...(d.data() as Sermon), id: d.id }));

  if (startDate || endDate) {
    const normalizedStart = toDateOnlyKey(startDate);
    const normalizedEnd = toDateOnlyKey(endDate);
    sermons = sermons.filter((s) => {
      if (!s.preachDates?.length) return false;
      return s.preachDates.some((pd) => {
        const date = toDateOnlyKey(pd.date);
        if (!date) return false;
        if (normalizedStart && date < normalizedStart) return false;
        if (normalizedEnd && date > normalizedEnd) return false;
        return true;
      });
    });
  }

  return sermons;
}

// --- WRITES (each touches ONLY its own field(s); never a whole-doc setDoc with
// a stale sibling snapshot — that is the structure-overwrite bug class #13) ---

/** Mirror PUT /api/sermons/:id — whitelist title/verse/isPreached/preparation. */
/**
 * Fields a caller may hand over when it wants ONLY those written.
 *
 * WHY. Callers used to pass a whole `Sermon` built from page state loaded when
 * the page opened, e.g. `updateSermon({ ...sermon, verse })`. This service then
 * wrote title, verse, isPreached AND the entire nested `preparation` — so saving
 * a verse silently reverted preparation edited meanwhile on another device.
 * Passing an explicit patch keeps the blast radius to what the user touched.
 */
export type SermonCoreUpdate = Partial<Pick<Sermon, 'title' | 'verse' | 'isPreached' | 'preparation'>>;

/** Aggregate name for the sermon's own fields (title/verse/isPreached/preparation). */
export const SERMON_CORE_AGGREGATE = 'core';

export async function updateSermonViaClient(
  updated: Sermon,
  patch?: SermonCoreUpdate,
  expectedRevision: number | null = null
): Promise<Sermon | null> {
  const ref = sermonRef(updated.id);
  const data: Record<string, unknown> = {};
  const source = patch ?? updated;
  // `patch` is authoritative when given: only the keys it carries are written,
  // so an absent key means "leave whatever is on the server alone".
  if (!patch || 'title' in patch) {
    if (source.title) data.title = source.title;
  }
  if (!patch || 'verse' in patch) {
    if (source.verse) data.verse = source.verse;
  }
  if (!patch || 'isPreached' in patch) {
    if (typeof source.isPreached === 'boolean') data.isPreached = source.isPreached;
  }
  if (!patch || 'preparation' in patch) {
    if (source.preparation && typeof source.preparation === 'object') {
      data.preparation = source.preparation;
    }
  }
  if (Object.keys(data).length === 0) return null; // server replies 400 -> service null
  data.updatedAt = now();

  // GUARDED PATH: refuse a save built from an older revision instead of quietly
  // replacing what another device stored. Callers that cannot state a revision
  // keep the previous behaviour untouched.
  if (expectedRevision !== null) {
    const committed = await conflictSafeUpdate(
      ref,
      deepCleanUndefined(data) as SermonUpdate,
      'Sermon not found',
      { aggregate: SERMON_CORE_AGGREGATE, expectedRevision }
    );
    // DO NOT re-read here. Proven live with a probe: right after the transaction
    // commits, `getDoc` still answers from the local replica, which has not yet
    // caught up — it returned the OTHER device's text and the pre-commit revision,
    // so a correct save put stale data back on screen. We already know exactly what
    // was written; returning it (with the committed revision) also keeps the next
    // save's stated revision current, instead of refusing the person's own follow-up
    // edit as stale.
    return {
      ...updated,
      ...(data as Partial<Sermon>),
      rev: { ...(updated.rev ?? {}), [SERMON_CORE_AGGREGATE]: committed },
    };
  }

  // Unguarded path still advances the counter — see revisionBump.
  await updateDoc(ref, {
    ...(deepCleanUndefined(data) as SermonUpdate),
    ...revisionBump(SERMON_CORE_AGGREGATE),
  });
  return (await getSermonByIdViaClient(updated.id)) ?? null;
}

/** Mirror PUT /api/sermons/:id with { preparation } only. */
export async function updateSermonPreparationViaClient(
  sermonId: string,
  preparation: Preparation,
  changedKeys?: (keyof Preparation)[]
): Promise<Preparation | null> {
  // WHOLE-OBJECT WRITE (no changedKeys) replaces every preparation step from the
  // caller's snapshot, so editing one step on this device reverts a DIFFERENT
  // step edited meanwhile on another. When the caller knows which steps changed
  // we address them by nested field path instead, leaving the rest untouched —
  // Firestore merges `a.b` writes into the existing map rather than replacing it.
  if (changedKeys && changedKeys.length > 0) {
    const patch: { [field: string]: FieldValue | Partial<unknown> | undefined } = {
      updatedAt: now(),
    };
    changedKeys.forEach((key) => {
      const value = preparation[key];
      // A step the user REMOVED must be deleted explicitly. Simply omitting the
      // field path leaves the old value on the server: the UI looked saved and the
      // deleted step reappeared after a reload. Firestore needs the deleteField
      // sentinel to remove a nested field.
      patch[`preparation.${String(key)}`] = value === undefined ? deleteField() : value;
    });
    await updateDoc(sermonRef(sermonId), deepCleanUndefined(patch));
    return preparation;
  }

  await updateDoc(sermonRef(sermonId), deepCleanUndefined({ preparation, updatedAt: now() }));
  return preparation;
}

/**
 * Mirror PUT /api/thoughts-by-section — writes BOTH thoughtsBySection and the
 * legacy `structure` alias, and (matching that route) does NOT bump updatedAt.
 */
export async function updateStructureViaClient(
  sermonId: string,
  structure: ThoughtsBySection
): Promise<{ message: string }> {
  await updateDoc(
    sermonRef(sermonId),
    deepCleanUndefined({ thoughtsBySection: structure, structure })
  );
  return { message: 'ThoughtsBySection updated successfully' };
}

/** Mirror PUT /api/sermons/outline — writes only the outline field. */
export async function updateSermonOutlineViaClient(
  sermonId: string,
  outline: SermonOutline
): Promise<SermonOutline | null> {
  if (!outline.main) outline.main = [];
  await updateDoc(sermonRef(sermonId), deepCleanUndefined({ outline, updatedAt: now() }));
  return outline;
}

export async function applyScratchToOutlineViaClient(
  sermonId: string,
  outline: SermonOutline,
  scratch: ScratchNote[]
): Promise<{ outline: SermonOutline; scratch: ScratchNote[] }> {
  const cleanOutline: SermonOutline = {
    introduction: outline.introduction ?? [],
    main: outline.main ?? [],
    conclusion: outline.conclusion ?? [],
  };
  const cleanScratch = sanitizeScratchNotes(scratch);

  await updateDoc(
    sermonRef(sermonId),
    deepCleanUndefined({ outline: cleanOutline, scratch: cleanScratch, updatedAt: now() })
  );

  return { outline: cleanOutline, scratch: cleanScratch };
}

// --- scratch[] ---

function sanitizeScratchNotes(scratch: ScratchNote[]): ScratchNote[] {
  return scratch.map((note) => {
    const cleanNote: ScratchNote = {
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
    };
    if (note.section) cleanNote.section = note.section;
    return deepCleanUndefined(cleanNote);
  });
}

async function writeScratchNotesViaClient(
  sermonId: string,
  scratch: ScratchNote[]
): Promise<ScratchNote[]> {
  const cleanScratch = sanitizeScratchNotes(scratch);
  await updateDoc(
    sermonRef(sermonId),
    deepCleanUndefined({ scratch: cleanScratch, updatedAt: now() })
  );
  return cleanScratch;
}

export async function addScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[]
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch);
}

export async function updateScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[]
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch);
}

export async function deleteScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[]
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch);
}

// --- thoughts[] ---

/**
 * Mirror POST /api/thoughts?manual=true — but idempotent by id.
 *
 * The id is reused from the caller's optimistic thought (which survives a reload
 * and is replayed unchanged on retry) instead of being minted fresh each call;
 * the optimistic "local-" prefix is stripped so the saved thought is classified
 * as real, not pending. Combined with INSERT-IF-ABSENT by that id, a create sent
 * twice — the native Firestore offline queue committing the original write AND a
 * reload-recovered retry — collapses to ONE thought instead of two, and the
 * second send is a true no-op: it does NOT overwrite what is stored, because an
 * edit may have landed in between (a transient error can arrive after a commit).
 * (Plain arrayUnion would append a near-duplicate whenever a replay carries a
 * different `date`/field; an upsert-by-id REPLACE would clobber the newer edit.)
 */
export async function createManualThoughtViaClient(
  sermonId: string,
  thought: Thought
): Promise<Thought> {
  const stableId =
    thought.id && thought.id.startsWith(LOCAL_OPTIMISTIC_ID_PREFIX)
      ? thought.id.slice(LOCAL_OPTIMISTIC_ID_PREFIX.length)
      : thought.id || newClientId();

  const built: Thought = {
    id: stableId,
    text: thought.text,
    tags: stripStructureTags(thought.tags),
    date: thought.date || now(),
  };
  if (thought.outlinePointId) built.outlinePointId = thought.outlinePointId;
  if (thought.subPointId) built.subPointId = thought.subPointId;
  if (typeof thought.position === 'number') built.position = thought.position;

  if (!(built.id && built.text && built.tags && built.date)) {
    throw new Error('Thought is missing required fields');
  }

  // INSERT-IF-ABSENT by id (not a replace). A create that is sent twice — the
  // native offline queue committing the original AND a reload-recovered retry —
  // must collapse to ONE thought; and because a transient error can arrive AFTER
  // a successful commit, the second attempt must NOT overwrite what is already
  // stored (an edit may have landed in between). Being a no-op on an existing id
  // is exactly what makes this operation safe to replay.
  const cleanBuilt = deepCleanUndefined(built);
  // On a replay we return what is actually STORED, not our own copy: the stored
  // one may already carry a newer edit, and echoing the stale copy would flash
  // the old text back into the UI.
  let committed: Thought = built;
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (sermon) => {
      const existing = sermon.thoughts || [];
      const stored = existing.find((t) => t.id === built.id);
      if (stored) {
        committed = stored; // replay no-op
        return null;
      }
      committed = built;
      return { thoughts: [...existing, cleanBuilt], updatedAt: now() };
    },
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true }
  );
  return committed;
}

/** Mirror PUT /api/thoughts — merge into the persisted thought, replace in-place. */
export async function updateThoughtViaClient(
  sermonId: string,
  updatedThought: Thought
): Promise<Thought> {
  if (!updatedThought.id) throw new Error('Thought id is required');

  // DELIBERATELY NOT transactional. This merges a FULL caller-supplied Thought
  // into the persisted one, so re-running the mutator is NOT safe: Firestore
  // internally retries a transaction up to 5 attempts and re-invokes the callback,
  // and a transient error can arrive AFTER a commit — a rerun would then reapply
  // this stale payload over a newer edit that landed in between. A transaction
  // here would therefore ADD a corruption path HEAD does not have. Making this
  // path safe requires accepting a minimal FIELD PATCH instead of a whole object
  // (tracked as the same-item-merge item in FIRESTORE_SYNC_RESEARCH.md); until
  // then it keeps HEAD's single read-then-write.
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const sermon = snap.data() as Sermon;
  const thoughts = sermon.thoughts || [];

  const oldThought = thoughts.find((t) => t.id === updatedThought.id);
  if (!oldThought) throw new Error('Thought not found in sermon');

  const merged: Thought = {
    ...oldThought,
    ...updatedThought,
    id: updatedThought.id,
    text: updatedThought.text ?? oldThought.text,
    date: updatedThought.date ?? oldThought.date,
    tags: stripStructureTags(
      Array.isArray(updatedThought.tags) ? updatedThought.tags : oldThought.tags
    ),
  };

  if (Object.prototype.hasOwnProperty.call(updatedThought, 'outlinePointId')) {
    merged.outlinePointId = updatedThought.outlinePointId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updatedThought, 'subPointId')) {
    merged.subPointId = updatedThought.subPointId ?? null;
  }
  if (!Object.prototype.hasOwnProperty.call(updatedThought, 'position')) {
    if (typeof oldThought.position === 'number') {
      merged.position = oldThought.position;
    } else {
      delete (merged as unknown as Record<string, unknown>).position;
    }
  }

  const sanitized = deepCleanUndefined(merged);
  if (!sanitized.id || !sanitized.text || !sanitized.date || !sanitized.tags) {
    throw new Error('Thought is missing required fields');
  }

  const updatedThoughts = thoughts.map((t) => (t.id === sanitized.id ? sanitized : t));
  await updateDoc(ref, { thoughts: updatedThoughts, updatedAt: now() });
  return sanitized;
}

/** Mirror DELETE /api/thoughts — remove the thought (by id) from the array. */
export async function deleteThoughtViaClient(sermonId: string, thought: Thought): Promise<void> {
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (sermon) => ({
      thoughts: (sermon.thoughts || []).filter((t) => t.id !== thought.id),
      updatedAt: now(),
    }),
    SERMON_NOT_FOUND,
    // A removal recomputed against fresh data is idempotent: replaying it cannot
    // resurrect stale fields or drop a concurrent addition.
    { retryTransientAsQueuedWrite: true }
  );
}

// --- preachDates[] ---

/**
 * Mirror POST /api/sermons/:id/preach-dates. Insert-if-absent by client id (an
 * existing id is returned UNCHANGED — never replaced):
 * a replayed add (the dashboard online-flush double-fire) is a no-op, so the
 * native offline queue can own create-with-planned-date without duplicating the
 * date. Without an id we generate one (back-compat with non-replayed callers).
 */
export async function addPreachDateViaClient(
  sermonId: string,
  data: Omit<PreachDate, 'id' | 'createdAt'> & { id?: string }
): Promise<PreachDate> {
  const normalizedDate = toDateOnlyKey(data.date);
  if (!normalizedDate) throw new Error('Invalid preach date format');

  const ref = sermonRef(sermonId);

  if (data.id) {
    // Insert-if-absent by client id (an existing id is returned UNCHANGED, never
    // replaced). atomicUpdate recomputes against fresh data,
    // so a date added on another device survives instead of being wiped.
    let committed: PreachDate | undefined;
    await atomicUpdate<Sermon>(
      ref,
      (sermon) => {
        const preachDates = sermon.preachDates || [];
        const existing = preachDates.find((pd) => pd.id === data.id);
        if (existing) {
          committed = existing; // replay no-op
          return null;
        }
        committed = {
          ...data,
          date: normalizedDate,
          status: data.status || 'planned',
          id: data.id,
          createdAt: now(),
        } as PreachDate;
        return {
          preachDates: [...preachDates, deepCleanUndefined(committed)],
          updatedAt: now(),
        };
      },
      SERMON_NOT_FOUND,
      { retryTransientAsQueuedWrite: true } // no-ops when the id already exists
    );
    return committed as PreachDate;
  }

  const newPreachDate: PreachDate = {
    ...data,
    date: normalizedDate,
    status: data.status || 'planned',
    id: newClientId(),
    createdAt: now(),
  };
  await updateDoc(ref, {
    preachDates: arrayUnion(deepCleanUndefined(newPreachDate)),
    updatedAt: now(),
  });
  return newPreachDate;
}

/** Mirror PUT /api/sermons/:id/preach-dates/:dateId — replace by id, preserve id+createdAt. */
export async function updatePreachDateViaClient(
  sermonId: string,
  dateId: string,
  updates: Partial<PreachDate>
): Promise<PreachDate> {
  // DELIBERATELY NOT transactional — same reason as updateThoughtViaClient: it
  // merges caller-supplied fields into the persisted entry, and Firestore may
  // re-run a transaction callback (up to 5 attempts) even after a commit whose
  // response was lost, which would reapply this payload over a newer edit.
  // Order matters: read + locate BEFORE validating the date, so a missing
  // sermon/date still reports not-found (HEAD's error precedence).
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const preachDates = (snap.data() as Sermon).preachDates || [];
  const index = preachDates.findIndex((pd) => pd.id === dateId);
  if (index === -1) throw new Error('Preach date not found');

  const normalizedDate = updates.date === undefined ? undefined : toDateOnlyKey(updates.date);
  if (updates.date !== undefined && !normalizedDate) {
    throw new Error('Invalid preach date format');
  }

  const updatedPreachDate: PreachDate = {
    ...preachDates[index],
    ...updates,
    ...(normalizedDate ? { date: normalizedDate } : {}),
    id: preachDates[index].id,
    createdAt: preachDates[index].createdAt,
  };

  const updatedArray = [...preachDates];
  updatedArray[index] = deepCleanUndefined(updatedPreachDate);
  await updateDoc(ref, { preachDates: updatedArray, updatedAt: now() });
  return updatedPreachDate;
}

/** Mirror DELETE /api/sermons/:id/preach-dates/:dateId. */
export async function deletePreachDateViaClient(sermonId: string, dateId: string): Promise<void> {
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (sermon) => ({
      preachDates: (sermon.preachDates || []).filter((pd) => pd.id !== dateId),
      updatedAt: now(),
    }),
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true } // removal is idempotent on fresh data
  );
}

// NB: createSermon is intentionally NOT migrated — it stays on the server. See
// the explainer in sermon.service.ts (offline create is the dashboard
// optimistic-retry layer + non-idempotent planned-date sub-step + series
// cascade). All other own-doc sermon writes above go through the client SDK.
