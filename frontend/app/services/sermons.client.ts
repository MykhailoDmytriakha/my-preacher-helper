import {
  arrayRemove,
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
import {
  conflictSafeUpdate,
  isStaleWriteError,
  isUnreachableWriteError,
  readRevision,
  revisionBump,
  revisionedUpdate,
} from '@/services/conflictSafeUpdate.client';
import { auth } from '@/services/firebaseAuth.service';
import { enqueueWrite, listOutbox, newIntentId, type OutboxEntry } from '@/services/writeOutbox.client';
import { changedFields } from '@/utils/changedFields';
import { newClientId } from '@/utils/clientId';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { mergeOutline } from '@/utils/mergeOutline';
import { mergeScratch } from '@/utils/mergeScratch';
import { mergeSections } from '@/utils/mergeSections';
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

/** Thoughts are their own aggregate: editing one must not collide with the title. */
export const SERMON_THOUGHTS_AGGREGATE = 'thoughts';
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
/**
 * Aggregates whose writers live below. The names MIRROR the server's, because
 * both write the same fields and a counter only tells the truth when every
 * writer of that field moves the SAME number: `sermons.repository.ts:132`
 * ('outline'), `:369,:392` ('preachDates'), `api/thoughts-by-section/route.ts:42`
 * ('thoughts' — a section arrangement is an arrangement OF thoughts).
 */
export const SERMON_OUTLINE_AGGREGATE = 'outline';
export const SERMON_SCRATCH_AGGREGATE = 'scratch';
export const SERMON_PREACH_DATES_AGGREGATE = 'preachDates';
export const SERMON_PREPARATION_AGGREGATE = 'preparation';
export const SERMON_PLAN_AGGREGATE = 'plan';

export async function updateSermonViaClient(
  updated: Sermon,
  patch?: SermonCoreUpdate,
  expectedRevision: number | null = null,
  /** The written fields AS THE EDITOR OPENED THEM — see the guard. */
  expectedBaseline?: Record<string, unknown> | null
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
      {
        aggregate: SERMON_CORE_AGGREGATE,
        expectedRevision,
        // Content check on top of the counter: an old build that changed the title
        // without bumping is invisible to the number and visible here.
        expectedBaseline,
        // Offline this queues the INTENT; `replayOutbox` puts it back through the
        // same guard on reconnect, stating the revision the text was built from.
        outboxRoute: updated.userId
          ? { uid: updated.userId, collection: SERMONS_COLLECTION, docId: updated.id, savedAt: Date.now() }
          : undefined,
      }
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
    await updateDoc(sermonRef(sermonId), {
      ...deepCleanUndefined(patch),
      ...revisionBump(SERMON_PREPARATION_AGGREGATE),
    });
    return preparation;
  }

  /**
   * OFFLINE: NESTED FIELD PATHS, so the SERVER merges the steps.
   *
   * The transactional merge below cannot run without a server, and offline it
   * degrades to a queued whole-object write that replaces the map at reconnect. But
   * Firestore merges `preparation.<step>` paths into the stored map by itself: steps
   * this screen does not mention keep whatever they hold. Same protection, no
   * transaction, no base, no caller change — the queue applies it at reconnect
   * instead of overwriting.
   */
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const nestedPatch: { [field: string]: FieldValue | Partial<unknown> | undefined } = {
      updatedAt: now(),
      ...revisionBump(SERMON_PREPARATION_AGGREGATE),
    };
    Object.entries(preparation as Record<string, unknown>).forEach(([key, value]) => {
      nestedPatch[`preparation.${key}`] = value as Partial<unknown>;
    });
    await updateDoc(sermonRef(sermonId), deepCleanUndefined(nestedPatch));
    return preparation;
  }

  // WHOLE-OBJECT BRANCH — now merged PER STEP instead of replacing everything.
  //
  // A caller that cannot say which steps it changed used to hand over its entire
  // snapshot, so a step filled in on the phone this morning vanished when the laptop
  // saved any other step tonight. Merging by key keeps both: the caller's steps win
  // for the keys it carries, and anything it has never heard of stays. Like the
  // scratch merge, this NEVER refuses — so it cannot introduce the "refused forever"
  // failure that guarded editors kept producing. Deleting a step still goes through
  // the `changedKeys` path above, which is the only way to say "remove this".
  let committedPreparation = preparation;
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (current) => {
      committedPreparation = {
        ...((current.preparation ?? {}) as Preparation),
        ...preparation,
      };
      return {
        ...deepCleanUndefined({ preparation: committedPreparation, updatedAt: now() }),
        ...revisionBump(SERMON_PREPARATION_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true }
  );
  return committedPreparation;
}

/**
 * Mirror PUT /api/thoughts-by-section — writes BOTH thoughtsBySection and the
 * legacy `structure` alias, and (matching that route) does NOT bump updatedAt.
 */
export async function updateStructureViaClient(
  sermonId: string,
  structure: ThoughtsBySection,
  /**
   * The arrangement AS THIS SCREEN OPENED IT. Given it, a thought moved only on the
   * other device keeps ITS new section instead of being pulled back here — see
   * `mergeSections`. Absent → behaviour unchanged.
   */
  baseStructure?: ThoughtsBySection | null
): Promise<{ message: string }> {
  // MERGED, not replaced. The map is built from the sermon this screen loaded, so a
  // thought created on another device is simply absent from it — and writing the map
  // whole dropped that thought out of every section, leaving it shown nowhere until
  // someone re-sorted by hand. `mergeSections` keeps ids this map never mentions
  // where the document has them, needs nothing from the five call sites, and cannot
  // refuse. See its own file for why no baseline is required.
  //
  // OFFLINE: the same intent-in-the-queue as the plan — the arrangement is ordered,
  // so a queued computed map would replace the other device's at reconnect.
  const structureIntent = () =>
    queueMergeIntent(
      sermonId,
      SERMON_THOUGHTS_AGGREGATE,
      { structure: deepCleanUndefined(structure) as unknown } as Record<string, unknown>,
      { kind: 'structure', base: baseStructure ?? undefined }
    );

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (structureIntent()) return { message: 'ThoughtsBySection queued for merge on reconnect' };
    throw new UnsavedMergeError(SERMON_THOUGHTS_AGGREGATE);
  }

  let committed = structure;
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (current) => {
      committed = mergeSections(
        structure,
        (current.thoughtsBySection ?? current.structure) as ThoughtsBySection | undefined,
        baseStructure ?? null
      );
      return {
        ...deepCleanUndefined({ thoughtsBySection: committed, structure: committed }),
        ...revisionBump(SERMON_THOUGHTS_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND
  ).catch((error: unknown) => {
    // Captive portal: the OPERATION goes to the queue, never the computed map.
    if (isUnreachableWriteError(error)) {
      if (structureIntent()) return;
      throw new UnsavedMergeError(SERMON_THOUGHTS_AGGREGATE);
    }
    throw error;
  });
  return { message: 'ThoughtsBySection updated successfully' };
}

/**
 * Put the OPERATION in the durable queue — the one move that all the failure paths
 * need.
 *
 * Three moments demand it, and every one of them used to fall back to writing the
 * computed value instead: the browser knows it is offline; the browser THINKS it is
 * online but the transport is dead (a captive portal); and the queue itself refuses
 * for want of room. In all three the computed value is built from a cached read, so at
 * reconnect it replaces whatever the other device stored — the exact disease.
 *
 * Returns whether the intent is really stored. A `false` must never be turned into a
 * computed write; the caller reports a plain failure and keeps its text instead.
 */
function queueMergeIntent(
  sermonId: string,
  aggregate: string,
  patch: Record<string, unknown>,
  merge: NonNullable<OutboxEntry['merge']>
): boolean {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) return false;
  return enqueueWrite({
    id: newIntentId(),
    uid: actorUid,
    collection: SERMONS_COLLECTION,
    docId: sermonId,
    aggregate,
    patch,
    baseRevision: 0,
    merge,
    status: 'pending',
    savedAt: Date.now(),
  });
}

/** A save that could not be stored anywhere — the caller must NOT claim success. */
export class UnsavedMergeError extends Error {
  constructor(readonly aggregate: string) {
    super(`Could not store the ${aggregate} change for later`);
    this.name = 'UnsavedMergeError';
  }
}

export function isUnsavedMergeError(error: unknown): boolean {
  return (error as Error | null)?.name === 'UnsavedMergeError';
}

/**
 * The plan was written in two places and the same point differs in both.
 *
 * Reported instead of guessed. It carries what the server holds so the screen can
 * show both versions, and it marks itself as a refusal (`isStaleWrite`) because
 * that is what it is: nothing was written, and a person has to decide.
 */
export class OutlineCollisionError extends Error {
  readonly isStaleWrite = true;
  readonly aggregate = SERMON_OUTLINE_AGGREGATE;
  constructor(
    readonly collisions: string[],
    readonly serverOutline: SermonOutline | null,
    readonly actualRevision: number
  ) {
    super(`The plan changed on another device in the same point(s): ${collisions.join(', ')}`);
    this.name = 'OutlineCollisionError';
  }
}

export function isOutlineCollisionError(error: unknown): error is OutlineCollisionError {
  return (error as OutlineCollisionError | null)?.name === 'OutlineCollisionError';
}

/**
 * Mirror PUT /api/sermons/outline — writes only the outline field.
 *
 * WITH `baseOutline` the write MERGES instead of replacing. The plan is stored as
 * one whole field, so without a base this call takes whatever the caller assembled
 * and overwrites every point — and a laptop that has been open since last night
 * erases the point added from the phone this morning, silently. Given the plan the
 * editor OPENED with, the merge can tell "added there" from "deleted here" and keep
 * both people's work; only the same point written in two places is a real question,
 * and that one is refused rather than guessed.
 *
 * The merge is computed INSIDE the transaction attempt, from the document as just
 * read. That is what makes it safe when Firestore re-runs the callback (it may,
 * even after a commit whose response was lost): each attempt merges against fresh
 * data instead of replaying a snapshot from before.
 */
export async function updateSermonOutlineViaClient(
  sermonId: string,
  outline: SermonOutline,
  options?: {
    baseOutline?: SermonOutline | null;
    /**
     * What to do when the SAME point was rewritten in two places.
     *
     * `refuse` (the default) throws `OutlineCollisionError` so the caller can show a
     * choice. ONLY a caller that stores the refused plan may ask for it: a refusal
     * reaching a plain `catch` becomes an error toast and the person's edit dies at
     * the next reload — "overwrote someone else" turned into "silently lost your own".
     *
     * `preferMine` merges without refusing: everything the other device added still
     * survives, and the local wording wins for the one point edited in both places.
     * That is exactly what happened before merging existed, so it can never be worse
     * than the old whole-field overwrite — while still saving the other points.
     */
    onCollision?: 'refuse' | 'preferMine';
  }
): Promise<SermonOutline | null> {
  if (!outline.main) outline.main = [];

  if (options && 'baseOutline' in options) {
    /**
     * OFFLINE: QUEUE THE OPERATION, not the computed plan.
     *
     * The merge below needs a server. Offline it degrades to "read the cache, compute
     * the whole plan, hand it to the native queue" — and at reconnect that plan
     * replaces the point added on the phone. The plan is ordered, so there is no
     * commutative Firestore operation to lean on the way scratch and preparation do.
     *
     * So the INTENT goes into the durable outbox instead, carrying what this editor
     * started from; `replayOutbox` re-runs THIS function on reconnect, and the merge
     * happens against what the server actually holds. If storage refuses the intent,
     * we fall through to the old behaviour rather than pretending — a queued stale
     * plan is bad, but losing the edit outright is worse.
     */
    const outlineIntent = () =>
      queueMergeIntent(
        sermonId,
        SERMON_OUTLINE_AGGREGATE,
        { outline: deepCleanUndefined(outline) as unknown } as Record<string, unknown>,
        { kind: 'outline', base: options.baseOutline ?? null }
      );

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (outlineIntent()) return outline;
      // Nowhere to store the operation. Say so — a computed plan queued from a cached
      // read would replace the other device's points at reconnect, which is the very
      // thing this path exists to prevent.
      throw new UnsavedMergeError(SERMON_OUTLINE_AGGREGATE);
    }

    let committed: SermonOutline = outline;
    await atomicUpdate<Sermon>(
      sermonRef(sermonId),
      (current) => {
        const { outline: merged, collisions } = mergeOutline(
          options.baseOutline ?? null,
          outline,
          current.outline ?? null,
          // Callers with nowhere to ask let the local decision win — including a
          // deletion, which otherwise comes back on the next save.
          options.onCollision === 'preferMine'
        );
        if (collisions.length > 0 && options.onCollision !== 'preferMine') {
          throw new OutlineCollisionError(
            collisions,
            current.outline ?? null,
            readRevision(current as unknown as Record<string, unknown>, SERMON_OUTLINE_AGGREGATE)
          );
        }
        committed = merged;
        return {
          ...deepCleanUndefined({ outline: merged, updatedAt: now() }),
          ...revisionBump(SERMON_OUTLINE_AGGREGATE),
        };
      },
      SERMON_NOT_FOUND
    ).catch((error: unknown) => {
      // A CAPTIVE PORTAL leaves `navigator.onLine === true` and the transaction fails
      // with `unavailable`. Queue the OPERATION — never the merge computed from a
      // cached read, which is what the generic queued fallback would have written.
      if (isUnreachableWriteError(error)) {
        if (outlineIntent()) return;
        throw new UnsavedMergeError(SERMON_OUTLINE_AGGREGATE);
      }
      throw error;
    });
    return committed;
  }

  await updateDoc(sermonRef(sermonId), {
    ...deepCleanUndefined({ outline, updatedAt: now() }),
    ...revisionBump(SERMON_OUTLINE_AGGREGATE),
  });
  return outline;
}

export async function applyScratchToOutlineViaClient(
  sermonId: string,
  outline: SermonOutline,
  scratch: ScratchNote[],
  /**
   * What the screen started this apply from — the plan AND the note list. With them
   * BOTH fields are merged in ONE transaction instead of being replaced together,
   * which matters here more than anywhere: this single write touches the two things
   * a person is most likely to have changed on the other device.
   */
  base?: { outline?: SermonOutline | null; scratch?: ScratchNote[] | null }
): Promise<{ outline: SermonOutline; scratch: ScratchNote[] }> {
  const cleanOutline: SermonOutline = {
    introduction: outline.introduction ?? [],
    main: outline.main ?? [],
    conclusion: outline.conclusion ?? [],
  };
  const cleanScratch = sanitizeScratchNotes(scratch);

  if (!base) {
    await updateDoc(sermonRef(sermonId), {
      ...deepCleanUndefined({ outline: cleanOutline, scratch: cleanScratch, updatedAt: now() }),
      ...revisionBump(SERMON_OUTLINE_AGGREGATE),
      ...revisionBump(SERMON_SCRATCH_AGGREGATE),
    });
    return { outline: cleanOutline, scratch: cleanScratch };
  }

  // OFFLINE: intent in the queue, for the same reason as the plan — this write
  // carries an ordered structure, so a queued computed value replaces the other
  // device's plan AND notes at reconnect.
  const applyIntent = () =>
    queueMergeIntent(
      sermonId,
      SERMON_OUTLINE_AGGREGATE,
      {
        outline: deepCleanUndefined(cleanOutline) as unknown,
        scratch: deepCleanUndefined(cleanScratch) as unknown,
      } as Record<string, unknown>,
      { kind: 'applyScratch', base }
    );

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (applyIntent()) return { outline: cleanOutline, scratch: cleanScratch };
    throw new UnsavedMergeError(SERMON_OUTLINE_AGGREGATE);
  }

  let committedOutline = cleanOutline;
  let committedScratch = cleanScratch;
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (current) => {
      // Both merges recomputed INSIDE the attempt, from the document as just read —
      // the SDK may re-run this, and a merge built from an earlier snapshot would
      // replay stale data over a newer commit.
      const { outline: mergedOutline } = mergeOutline(
        base.outline ?? null,
        cleanOutline,
        current.outline ?? null
      );
      // A collision here is NOT refused: this path consumes notes into the plan, and
      // stopping it would strand them in neither place. The local wording wins, which
      // is what the whole-field write did — never worse, and the other device's
      // untouched points and notes now survive.
      committedOutline = mergedOutline;
      committedScratch = sanitizeScratchNotes(
        mergeScratch(base.scratch ?? null, cleanScratch, current.scratch ?? [])
      );
      return {
        ...deepCleanUndefined({
          outline: committedOutline,
          scratch: committedScratch,
          updatedAt: now(),
        }),
        ...revisionBump(SERMON_OUTLINE_AGGREGATE),
        ...revisionBump(SERMON_SCRATCH_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND
  ).catch((error: unknown) => {
    if (isUnreachableWriteError(error)) {
      if (applyIntent()) return;
      throw new UnsavedMergeError(SERMON_OUTLINE_AGGREGATE);
    }
    throw error;
  });

  return { outline: committedOutline, scratch: committedScratch };
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
  scratch: ScratchNote[],
  /**
   * The list this screen started the operation from. Given it, the write MERGES by
   * note id instead of replacing the whole array — a note captured on the phone this
   * morning survives a save from a laptop that never saw it. The merge NEVER refuses
   * (notes are separate items; only the same note edited twice overlaps, and there
   * the local wording wins exactly as it did before), so this cannot grow the
   * "refused forever" failure that guarded UIs kept producing.
   */
  baseScratch?: ScratchNote[] | null
): Promise<ScratchNote[]> {
  const cleanScratch = sanitizeScratchNotes(scratch);

  if (baseScratch === undefined) {
    await updateDoc(sermonRef(sermonId), {
      ...deepCleanUndefined({ scratch: cleanScratch, updatedAt: now() }),
      ...revisionBump(SERMON_SCRATCH_AGGREGATE),
    });
    return cleanScratch;
  }

  /**
   * OFFLINE: SEND THE OPERATION, NOT THE ARRAY.
   *
   * The merge below lives inside a transaction, and a transaction cannot run without
   * a server — offline it degrades to "read the cache, compute the whole array, queue
   * it", and on reconnect that array replaces whatever the other device stored. The
   * eighth review found exactly that, and it is the owner's own scenario: notes taken
   * on a train, phone used at home, laptop reconnects later.
   *
   * Firestore's own `arrayUnion`/`arrayRemove` are commutative on the SERVER: queued
   * offline, they apply to whatever is stored at reconnect instead of overwriting it.
   * The operation is derived from the base — no caller has to change, and only the
   * pure add/remove shapes qualify. A text edit has no commutative equivalent and
   * still takes the transactional path (online) or the old whole-array queue (offline,
   * unchanged and no worse than before).
   */
  if (typeof navigator !== 'undefined' && navigator.onLine === false && baseScratch) {
    const baseIds = new Set(baseScratch.map((n) => n.id));
    const mineIds = new Set(cleanScratch.map((n) => n.id));
    const added = cleanScratch.filter((n) => !baseIds.has(n.id));
    const removed = baseScratch.filter((n) => !mineIds.has(n.id));
    const unchangedElsewhere = cleanScratch.every((n) => {
      if (!baseIds.has(n.id)) return true;
      const before = baseScratch.find((b) => b.id === n.id);
      return before ? before.text === n.text && before.section === n.section : true;
    });

    if (unchangedElsewhere && added.length > 0 && removed.length === 0) {
      await updateDoc(sermonRef(sermonId), {
        scratch: arrayUnion(...added.map((n) => deepCleanUndefined(n))),
        updatedAt: now(),
        ...revisionBump(SERMON_SCRATCH_AGGREGATE),
      });
      return cleanScratch;
    }
    if (unchangedElsewhere && removed.length > 0 && added.length === 0) {
      await updateDoc(sermonRef(sermonId), {
        scratch: arrayRemove(...removed.map((n) => deepCleanUndefined(n))),
        updatedAt: now(),
        ...revisionBump(SERMON_SCRATCH_AGGREGATE),
      });
      return cleanScratch;
    }

    // A TEXT EDIT has no commutative equivalent — `arrayUnion`/`arrayRemove` only
    // describe membership, not new wording. Editing a note offline used to queue the
    // whole computed array, so at reconnect it deleted a note added elsewhere. The
    // OPERATION goes to the durable queue instead, and the replay re-runs this writer
    // so the merge happens against fresh data.
    if (
      queueMergeIntent(
        sermonId,
        SERMON_SCRATCH_AGGREGATE,
        { scratch: deepCleanUndefined(cleanScratch) as unknown } as Record<string, unknown>,
        { kind: 'scratch', base: baseScratch }
      )
    ) {
      return cleanScratch;
    }
    throw new UnsavedMergeError(SERMON_SCRATCH_AGGREGATE);
  }

  let committed = cleanScratch;
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (current) => {
      // Merged INSIDE the attempt, from the document as just read: Firestore may
      // re-run this callback, and a merge computed from a pre-read snapshot would
      // replay stale data over a newer commit.
      committed = sanitizeScratchNotes(
        mergeScratch(baseScratch, cleanScratch, current.scratch ?? [])
      );
      return {
        ...deepCleanUndefined({ scratch: committed, updatedAt: now() }),
        ...revisionBump(SERMON_SCRATCH_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true }
  );
  return committed;
}

export async function addScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[],
  /** The list this screen started from — see `writeScratchNotesViaClient`. */
  baseScratch?: ScratchNote[] | null
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch, baseScratch);
}

export async function updateScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[],
  /** The list this screen started from — see `writeScratchNotesViaClient`. */
  baseScratch?: ScratchNote[] | null
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch, baseScratch);
}

export async function deleteScratchNoteViaClient(
  sermonId: string,
  scratch: ScratchNote[],
  /** The list this screen started from — see `writeScratchNotesViaClient`. */
  baseScratch?: ScratchNote[] | null
): Promise<ScratchNote[]> {
  return writeScratchNotesViaClient(sermonId, scratch, baseScratch);
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
    // Invalid input never becomes valid on replay — code it so the person is told
    // the truth instead of being offered an endless retry.
    throw Object.assign(new Error('Thought is missing required fields'), { code: 'invalid-argument' });
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
      return {
        thoughts: [...existing, cleanBuilt],
        updatedAt: now(),
        ...revisionBump(SERMON_THOUGHTS_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true }
  );
  return committed;
}

/** Mirror PUT /api/thoughts — merge into the persisted thought, replace in-place. */
export async function updateThoughtViaClient(
  sermonId: string,
  updatedThought: Thought,
  /**
   * The thought AS THIS SCREEN OPENED IT. Given it, only the fields the person
   * actually changed are written; everything else keeps whatever is stored.
   *
   * Without it the whole thought travels, and an untouched field carries this
   * screen's hours-old copy of itself: drag a thought to another plan point at noon
   * and the laptop also re-sends the text it read at eight, over the paragraph
   * rewritten on the phone at nine. The transaction cannot see that — it merges
   * SIBLINGS correctly and then writes the stale text as if it were an edit.
   *
   * It never refuses: an unchanged field is simply not written, so this cannot grow
   * the "refused forever" failures that guarded screens kept producing.
   *
   * REQUIRED ON PURPOSE — `null` is a decision, not a default. While this parameter
   * was optional, three call sites silently took the whole-object path just by not
   * mentioning it, and one of them was a padlock button that republished stale text.
   * A caller with genuinely no opening value writes `null` and the old behaviour is
   * restored; nobody gets it by forgetting.
   */
  baseThought: Thought | null
): Promise<Thought> {
  if (!updatedThought.id) throw new Error('Thought id is required');

  // TRANSACTIONAL, and the merge happens INSIDE each attempt.
  //
  // This used to be a single read-then-write of the WHOLE thoughts array, which
  // made it the owner's original bug in miniature: edit thought A on the phone,
  // edit thought B on the laptop an hour later, and the laptop's array — built
  // from what it read before — silently restored the old A.
  //
  // The earlier objection to a transaction was that re-running the callback could
  // reapply a stale payload. That only holds when the merge is computed from a
  // caller-held array snapshot. Computing it from the FRESHLY READ document on
  // every attempt makes the operation idempotent for the target thought and always
  // current for its siblings, which is what the person actually asked for. What
  // remains is a same-thought overwrite when another device edits the SAME thought
  // within the retry window — sub-second, and far less likely than the hours-apart
  // sibling loss this replaces.
  const ref = sermonRef(sermonId);
  let sanitizedResult!: Thought;

  await atomicUpdate<Sermon>(
    ref,
    (data) => {
      const thoughts = data.thoughts || [];
      const oldThought = thoughts.find((t) => t.id === updatedThought.id);
      if (!oldThought) throw Object.assign(new Error('Thought not found in sermon'), { code: 'not-found' });

      /**
       * WHAT THE PERSON ACTUALLY CHANGED — the only thing this write may state.
       * With no opening value we cannot tell, so everything is claimed, as before.
       */
      const intent: Partial<Thought> = baseThought
        ? changedFields(baseThought, updatedThought)
        : updatedThought;

        const merged: Thought = {
          ...oldThought,
          ...intent,
          id: updatedThought.id,
          text: intent.text ?? oldThought.text,
          date: intent.date ?? oldThought.date,
          tags: stripStructureTags(
      Array.isArray(intent.tags) ? intent.tags : oldThought.tags
          ),
        };

        if (Object.prototype.hasOwnProperty.call(intent, 'outlinePointId')) {
          merged.outlinePointId = intent.outlinePointId ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(intent, 'subPointId')) {
          merged.subPointId = intent.subPointId ?? null;
        }
        if (!Object.prototype.hasOwnProperty.call(intent, 'position')) {
          if (typeof oldThought.position === 'number') {
      merged.position = oldThought.position;
          } else {
      delete (merged as unknown as Record<string, unknown>).position;
          }
        }

      const sanitized = deepCleanUndefined(merged);
      if (!sanitized.id || !sanitized.text || !sanitized.date || !sanitized.tags) {
        throw Object.assign(new Error('Thought is missing required fields'), { code: 'invalid-argument' });
      }

      sanitizedResult = sanitized;
      return {
        thoughts: thoughts.map((t) => (t.id === sanitized.id ? sanitized : t)),
        updatedAt: now(),
        // Every writer of an aggregate advances its counter, or the counter lies.
        ...revisionBump(SERMON_THOUGHTS_AGGREGATE),
      };
    },
    SERMON_NOT_FOUND,
    // Re-running is safe: the merge is recomputed from the stored document.
    { retryTransientAsQueuedWrite: true }
  );

  return sanitizedResult;
}

/** Mirror DELETE /api/thoughts — remove the thought (by id) from the array. */
export async function deleteThoughtViaClient(sermonId: string, thought: Thought): Promise<void> {
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (sermon) => ({
      thoughts: (sermon.thoughts || []).filter((t) => t.id !== thought.id),
      updatedAt: now(),
      ...revisionBump(SERMON_THOUGHTS_AGGREGATE),
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
          ...revisionBump(SERMON_PREACH_DATES_AGGREGATE),
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
    ...revisionBump(SERMON_PREACH_DATES_AGGREGATE),
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
  await updateDoc(ref, {
    preachDates: updatedArray,
    updatedAt: now(),
    ...revisionBump(SERMON_PREACH_DATES_AGGREGATE),
  });
  return updatedPreachDate;
}

/** Mirror DELETE /api/sermons/:id/preach-dates/:dateId. */
export async function deletePreachDateViaClient(sermonId: string, dateId: string): Promise<void> {
  await atomicUpdate<Sermon>(
    sermonRef(sermonId),
    (sermon) => ({
      preachDates: (sermon.preachDates || []).filter((pd) => pd.id !== dateId),
      updatedAt: now(),
      ...revisionBump(SERMON_PREACH_DATES_AGGREGATE),
    }),
    SERMON_NOT_FOUND,
    { retryTransientAsQueuedWrite: true } // removal is idempotent on fresh data
  );
}

// NB: createSermon is intentionally NOT migrated — it stays on the server. See
// the explainer in sermon.service.ts (offline create is the dashboard
// optimistic-retry layer + non-idempotent planned-date sub-step + series
// cascade). All other own-doc sermon writes above go through the client SDK.


/**
 * WRITING THE PLAN'S TEXT — ONE KEY PER NODE, NEVER A WHOLE SECTION.
 *
 * The old path handed the server an entire `plan.<section>` object, so saving one card
 * rewrote every other card in that section: whichever save answered last won, and the
 * other paragraph was gone with nothing reported anywhere.
 *
 * Here each node's text is addressed on its own — `planText.<nodeId>` — exactly like
 * `preparation.<step>` above, and for the same reason: Firestore merges nested paths into
 * the stored map by itself, so keys this call does not mention keep whatever they hold.
 * That property survives the offline queue too, which is what makes this safe without a
 * transaction (transactions do not run offline at all) and without an outbox.
 *
 * `removedNodeIds` deletes keys outright rather than blanking them, so text left by a
 * deleted node does not linger in storage. Assembly already ignores such text — it walks
 * the structure — but debris that is never cleaned is debris that grows.
 *
 * SEPARATE KEYS ARE NOT A GUARD. Addressing one node cannot disturb its neighbours, and for
 * a while that was mistaken for safety. It is not: two devices editing THE SAME node still
 * race, and the later write wins with nothing reported. So the text goes through
 * `conflictSafeUpdate` like every other own-document write, and the baseline it is judged
 * against is stated PER NODE — the plan's counter moves whenever any point is saved, so
 * judging by the counter would refuse an edit to point two because point one was saved on
 * the phone. False conflicts teach people to click through the dialog, and then the real
 * one is skipped too.
 */
export interface PlanTextWriteContext {
  /** Owner of the document; an offline intent is queued under this uid and replayed later. */
  userId?: string;
  /**
   * What `planText.<nodeId>` HELD ON THE SERVER when this screen took that cell, per node.
   *
   * NOT what the screen displays: until a sermon's first save the text on screen comes from
   * the legacy per-section cells, which the `planText` map has never contained. Vouching for
   * the displayed value would compare it against an absent key and refuse every first save.
   *
   * A node with no entry is stated as `null`, so a node created elsewhere meanwhile is still
   * a difference rather than a match. Omit the whole map and the write proceeds unguarded,
   * exactly as it did before — used by callers that cannot prove what they started from.
   */
  baselineByNodeId?: Record<string, string | null>;
}

/**
 * What the server really held, read back off a refusal and keyed by NODE again.
 *
 * The guard reports field paths (`planText.<id>`) because that is what it compared; the screens
 * think in nodes. Translating lives here, beside the writer that chose the field names, so the
 * convention is stated once. Anything that is not this plan's text is ignored rather than
 * guessed at.
 */
export function planTextConflictValues(error: unknown): Record<string, string | null> | null {
  if (!isStaleWriteError(error)) return null;
  const byNode: Record<string, string | null> = {};
  Object.entries(error.serverValues).forEach(([field, value]) => {
    if (!field.startsWith('planText.')) return;
    byNode[field.slice('planText.'.length)] = typeof value === 'string' ? value : null;
  });
  return Object.keys(byNode).length > 0 ? byNode : null;
}

/**
 * Which plan cells are STILL WAITING to reach the server, from the offline queue.
 *
 * Two different things need this same answer, which is why it is one function:
 *
 *   - the baseline must NOT adopt a queued value as "what the server holds", or the screen
 *     starts vouching for text no server has seen — and if the replay is later refused, every
 *     further save is judged against a value that never existed;
 *   - the durable draft must KEEP such a cell, because "queued" is precisely "not confirmed",
 *     and dropping it is how the words written on a train stop existing anywhere the person
 *     can see.
 *
 * Reading the queue rather than tracking a flag is deliberate: the queue is the fact. A flag
 * would have to be released correctly on drain, on refusal and on reload, and any one of those
 * being wrong leaves a cell held for ever.
 */
export function pendingPlanTextNodeIds(
  uid: string | null | undefined,
  sermonId: string | null | undefined
): Set<string> {
  const waiting = new Set<string>();
  if (!uid || !sermonId) return waiting;
  listOutbox(uid)
    .filter((entry) => entry.docId === sermonId && entry.aggregate === SERMON_PLAN_AGGREGATE)
    .forEach((entry) => {
      Object.keys(entry.patch ?? {}).forEach((field) => {
        if (field.startsWith('planText.')) waiting.add(field.slice('planText.'.length));
      });
    });
  return waiting;
}

export async function savePlanTextViaClient(
  sermonId: string,
  changedText: Record<string, string>,
  removedNodeIds: string[] = [],
  { userId, baselineByNodeId }: PlanTextWriteContext = {}
): Promise<void> {
  const ref = sermonRef(sermonId);
  const writtenNodeIds = Object.keys(changedText);

  if (writtenNodeIds.length > 0) {
    const patch: { [field: string]: FieldValue | string | undefined } = { updatedAt: now() };
    writtenNodeIds.forEach((nodeId) => {
      // Node ids are UUIDs (`newClientId`), so they carry no dots and address cleanly.
      patch[`planText.${nodeId}`] = changedText[nodeId];
    });

    await conflictSafeUpdate(ref, patch, SERMON_NOT_FOUND, {
      aggregate: SERMON_PLAN_AGGREGATE,
      // The per-node baseline below is the real check; the shared counter would only add
      // refusals for points nobody touched. `null` here means "do not consult it".
      expectedRevision: null,
      expectedBaseline: baselineByNodeId
        ? Object.fromEntries(
            writtenNodeIds.map((nodeId) => [`planText.${nodeId}`, baselineByNodeId[nodeId] ?? null])
          )
        : undefined,
      outboxRoute: userId
        ? { uid: userId, collection: SERMONS_COLLECTION, docId: sermonId, savedAt: Date.now() }
        : undefined,
    });
  }

  if (removedNodeIds.length > 0) {
    /**
     * CLEANUP GOES THROUGH THE UNGUARDED DOOR, AND ON PURPOSE — TWICE OVER.
     *
     * Refusing it would be wrong: the node is already gone from the structure, nothing reads
     * its text, and a refusal would report a failed deletion for something that cannot fail
     * in any way that matters.
     *
     * It also must not ride with the guarded patch. An offline guarded write is stored in the
     * outbox as JSON, and `deleteField()` is a sentinel OBJECT: it survives `JSON.stringify`
     * as an ordinary map and would replay as "write this junk here" instead of "remove this".
     * An ordinary write has no such problem — Firestore's own queue keeps the sentinel intact.
     */
    const removalPatch: { [field: string]: FieldValue } = {};
    removedNodeIds.forEach((nodeId) => {
      removalPatch[`planText.${nodeId}`] = deleteField();
    });
    await revisionedUpdate(ref, removalPatch, SERMON_PLAN_AGGREGATE);
  }
}
