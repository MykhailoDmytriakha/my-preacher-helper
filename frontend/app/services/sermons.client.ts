import {
  arrayUnion,
  collection,
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
  Sermon,
  SermonOutline,
  Thought,
  ThoughtsBySection,
} from '@/models/models';
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
export async function updateSermonViaClient(updated: Sermon): Promise<Sermon | null> {
  const ref = sermonRef(updated.id);
  const data: Record<string, unknown> = {};
  if (updated.title) data.title = updated.title;
  if (updated.verse) data.verse = updated.verse;
  if (typeof updated.isPreached === 'boolean') data.isPreached = updated.isPreached;
  if (updated.preparation && typeof updated.preparation === 'object') {
    data.preparation = updated.preparation;
  }
  if (Object.keys(data).length === 0) return null; // server replies 400 -> service null
  data.updatedAt = now();
  await updateDoc(ref, deepCleanUndefined(data) as SermonUpdate);
  return (await getSermonByIdViaClient(updated.id)) ?? null;
}

/** Mirror PUT /api/sermons/:id with { preparation } only. */
export async function updateSermonPreparationViaClient(
  sermonId: string,
  preparation: Preparation
): Promise<Preparation | null> {
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

// --- thoughts[] ---

/**
 * Mirror POST /api/thoughts?manual=true — but idempotent by id.
 *
 * The id is reused from the caller's optimistic thought (which survives a reload
 * and is replayed unchanged on retry) instead of being minted fresh each call;
 * the optimistic "local-" prefix is stripped so the saved thought is classified
 * as real, not pending. Combined with upsert-by-id (read-modify-write), a create
 * that gets sent twice — the native Firestore offline queue committing the
 * original write AND a reload-recovered retry — collapses to ONE thought instead
 * of two. (Plain arrayUnion would append a near-duplicate whenever a replay
 * carries a different `date`/field.)
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

  // Upsert by id: replace a thought already carrying this id, else append. The
  // sermon doc exists here (we're adding to it), so the getDoc read passes the
  // ownsExisting rule — unlike a create-on-missing-doc pre-read, which would not.
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const existing = (snap.data() as Sermon).thoughts || [];
  const cleanBuilt = deepCleanUndefined(built);
  const idx = existing.findIndex((t) => t.id === built.id);
  const nextThoughts =
    idx === -1 ? [...existing, cleanBuilt] : existing.map((t, i) => (i === idx ? cleanBuilt : t));

  await updateDoc(ref, { thoughts: nextThoughts, updatedAt: now() });
  return built;
}

/** Mirror PUT /api/thoughts — merge into the persisted thought, replace in-place. */
export async function updateThoughtViaClient(
  sermonId: string,
  updatedThought: Thought
): Promise<Thought> {
  if (!updatedThought.id) throw new Error('Thought id is required');

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
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const sermon = snap.data() as Sermon;
  const thoughts = (sermon.thoughts || []).filter((t) => t.id !== thought.id);
  await updateDoc(ref, { thoughts, updatedAt: now() });
}

// --- preachDates[] ---

/**
 * Mirror POST /api/sermons/:id/preach-dates. Idempotent by a client-supplied id:
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
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
    const preachDates = (snap.data() as Sermon).preachDates || [];
    const existing = preachDates.find((pd) => pd.id === data.id);
    if (existing) return existing; // replay no-op
    const newPreachDate: PreachDate = {
      ...data,
      date: normalizedDate,
      status: data.status || 'planned',
      id: data.id,
      createdAt: now(),
    };
    await updateDoc(ref, {
      preachDates: [...preachDates, deepCleanUndefined(newPreachDate)],
      updatedAt: now(),
    });
    return newPreachDate;
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
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const sermon = snap.data() as Sermon;
  const preachDates = sermon.preachDates || [];
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
  const ref = sermonRef(sermonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(SERMON_NOT_FOUND);
  const sermon = snap.data() as Sermon;
  const preachDates = (sermon.preachDates || []).filter((pd) => pd.id !== dateId);
  await updateDoc(ref, { preachDates, updatedAt: now() });
}

// NB: createSermon is intentionally NOT migrated — it stays on the server. See
// the explainer in sermon.service.ts (offline create is the dashboard
// optimistic-retry layer + non-idempotent planned-date sub-step + series
// cascade). All other own-doc sermon writes above go through the client SDK.
