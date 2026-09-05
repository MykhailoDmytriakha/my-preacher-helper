import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { ScratchNote, StudyNote } from '@/models/models';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';
import { parseUsageCapError, type UsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Study-note reads, create, and content updates use the client Firestore SDK.
// DELETE stays on the server because it cascades into studyMaterials, and study
// materials + share links stay on the server.
/** The note body is one editable unit; server-side links (materialIds) are not. */
export const NOTE_AGGREGATE = 'note';

const NOTES_COLLECTION = 'studyNotes';

// Fields a client UPDATE may touch — the user-editable note content only. Never
// userId/id/createdAt/materialIds (materialIds is kept in sync by the server-side
// material<->note linking). updatedAt + isDraft are derived and set here.
/**
 * Fields a note update may carry.
 *
 * `relatedSermonIds` is NOT one of them, deliberately. Create has always stripped it as a
 * derived field, so leaving it writable on update kept a second, half-alive place to store
 * "this sermon was built on this note" — and two truths for one relationship is the defect
 * the sermon side exists to avoid (`Sermon.sourceNoteIds` is the only copy; the reverse
 * direction is derived). A future writer must not be able to revive it by accident.
 */
const STUDY_NOTE_UPDATE_FIELDS: (keyof StudyNote)[] = [
  'title', 'content', 'scriptureRefs', 'tags', 'type',
];

type NoteFilters = Partial<{
  q: string;
  tag: string;
  book: string;
  chapter: number;
  draftOnly: boolean;
}>;

// --- helpers mirroring studies.repository.ts + the GET route's filterNotes ---

function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

function normalizeNote(data: StudyNote): StudyNote {
  return {
    // `rev` rides along with the note itself. Taking the revision ONLY from the
    // freshness listener was not enough: a save that happened before the first
    // server snapshot went out with no revision at all, so the guard never ran and
    // a stale tab overwrote a newer one — reproduced with two tabs.
    ...data,
    scriptureRefs: data.scriptureRefs || [],
    tags: data.tags || [],
    materialIds: data.materialIds || [],
    isDraft: computeDraft(data),
  };
}

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

function filterNotesClient(notes: StudyNote[], filters: NoteFilters): StudyNote[] {
  let result = [...notes];
  const search = (filters.q || '').toLowerCase().trim();

  if (filters.draftOnly) {
    result = result.filter((note) => note.isDraft);
  }
  if (filters.tag) {
    result = result.filter((note) => note.tags?.includes(filters.tag as string));
  }
  if (filters.book) {
    const book = (filters.book as string).toLowerCase();
    result = result.filter((note) =>
      note.scriptureRefs?.some((ref) => ref.book.toLowerCase() === book)
    );
  }
  if (filters.chapter !== undefined && !Number.isNaN(Number(filters.chapter))) {
    const chapterNum = Number(filters.chapter);
    result = result.filter((note) =>
      note.scriptureRefs?.some((ref) => Number(ref.chapter) === chapterNum)
    );
  }
  if (search) {
    result = result.filter((note) => {
      const text = `${note.title || ''} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs
        ?.map((ref) => `${ref.book} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`)
        .join(' ')}`.toLowerCase();
      return text.includes(search);
    });
  }

  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// --- client-SDK read/write paths ---

async function getStudyNotesViaClient(userId: string, filters: NoteFilters): Promise<StudyNote[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, NOTES_COLLECTION), where('userId', '==', userId)));
  const notes = snap.docs.map((d) => normalizeNote({ ...(d.data() as StudyNote), id: d.id }));
  return filterNotesClient(notes, filters);
}

async function createStudyNoteViaClient(
  note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'> & { id?: string }
): Promise<StudyNote> {
  const db = getClientDb();
  const now = new Date().toISOString();
  // Persist the same shape the server does: derived/relational fields are NOT stored.
  const persistable = deepCleanUndefined({
    userId: note.userId,
    content: note.content ?? '',
    title: note.title || '',
    scriptureRefs: note.scriptureRefs || [],
    tags: note.tags || [],
    type: note.type || 'note',
    createdAt: now,
    updatedAt: now,
  });
  const hydrate = (id: string): StudyNote =>
    normalizeNote({
      ...persistable,
      id,
      materialIds: note.materialIds || [],
      relatedSermonIds: note.relatedSermonIds || [],
    } as StudyNote);

  // Idempotent create when the client supplies an id (offline autosave): setDoc on
  // that id creates-or-overwrites, so a replayed create reuses the same doc instead
  // of duplicating. We do NOT pre-read the doc: a get() on a not-yet-existing note
  // is denied by the `read: ownsExisting('userId')` rule (resource is null), which
  // would abort the create before the write. Security Rules still guarantee the
  // write can only target the caller's own note (create = ownsIncoming('userId')).
  if (note.id) {
    const ref = doc(db, NOTES_COLLECTION, note.id);
    await setDoc(ref, persistable);
    return hydrate(note.id);
  }

  const ref = await addDoc(collection(db, NOTES_COLLECTION), persistable);
  return hydrate(ref.id);
}

async function updateStudyNoteViaClient(
  id: string,
  updates: Partial<StudyNote>,
  expectedRevision: number | null = null,
  /**
   * The values these fields had when the editor OPENED — its own baseline, not a
   * fresh read. This is the whole difference between a real check and a no-op: a
   * fingerprint taken from a `getDoc` issued moments before the write compares the
   * server with itself and always agrees, so the stale text goes in.
   */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<StudyNote & { revision?: number }> {
  const db = getClientDb();
  const ref = doc(db, NOTES_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Study note not found');
  const existing = normalizeNote({ ...(snap.data() as StudyNote), id: snap.id });

  const whitelisted: Partial<StudyNote> = {};
  for (const field of STUDY_NOTE_UPDATE_FIELDS) {
    if (updates[field] !== undefined) (whitelisted as Record<string, unknown>)[field] = updates[field];
  }
  const merged = normalizeNote({ ...existing, ...whitelisted, updatedAt: new Date().toISOString() } as StudyNote);
  const cleanUpdates = deepCleanUndefined({ ...whitelisted, updatedAt: merged.updatedAt, isDraft: merged.isDraft });

  // GUARDED PATH. The caller tells us which revision its text was built from, so a
  // save from a tab that never saw the phone's edit is REFUSED instead of quietly
  // replacing it. Callers that cannot state a revision keep the old behaviour
  // exactly — this must not change anything for paths not yet migrated.
  if (expectedRevision !== null) {
    const revision = await conflictSafeUpdate(ref, cleanUpdates, 'Study note not found', {
      aggregate: NOTE_AGGREGATE,
      expectedRevision,
      // Content check alongside the counter: an old build that edits a note without
      // advancing the number is invisible to the counter and visible here. The
      // values come from the CALLER's baseline — see `expectedBaseline`.
      expectedBaseline,
      // Offline this queues the INTENT instead of writing blindly; `replayOutbox`
      // puts it back through this same guard on reconnect, stating the revision
      // the text was built from. Without the route an offline save would simply
      // fail — never become an unconditional write.
      outboxRoute: existing.userId
        ? { uid: existing.userId, collection: NOTES_COLLECTION, docId: id, savedAt: Date.now() }
        : undefined,
    });
    return { ...merged, revision };
  }

  // Unguarded path still advances the counter — otherwise it would lie and give a
  // later stale save false permission. `increment` works offline; a transaction does not.
  await updateDoc(ref, { ...cleanUpdates, ...revisionBump(NOTE_AGGREGATE) });
  return merged;
}

export async function getStudyNotes(userId: string, filters: NoteFilters = {}): Promise<StudyNote[]> {
  return getStudyNotesViaClient(userId, filters);
}

export async function createStudyNote(
  note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'> & { id?: string }
): Promise<StudyNote> {
  return createStudyNoteViaClient(note);
}

export async function updateStudyNote(
  id: string,
  updates: Partial<StudyNote> & { userId: string },
  expectedRevision: number | null = null,
  /** The note's fields as the editor OPENED them — see the guard's baseline. */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<StudyNote & { revision?: number }> {
  return updateStudyNoteViaClient(id, updates, expectedRevision, expectedBaseline);
}

/** What the cut route answers: atoms ready to be written into a sermon, plus why that many. */
export interface CutStudyNoteResponse {
  noteId: string;
  keyPassage: string;
  sections: Array<{ heading: string; count: number }>;
  notes: ScratchNote[];
  /** How many sections the whole note has, whichever slice this answer covers. */
  totalSections: number;
}

/** The plan of a cut, read from the stored note without calling a model. */
export interface NoteCutOutline {
  noteId: string;
  words: number;
  totalSections: number;
  sections: Array<{ index: number; heading: string; words: number }>;
  /** The requests the cut will take, in order; each stays well under the function wall. */
  slices: Array<{ offset: number; limit: number; words: number }>;
  corridor: { min: number; max: number };
}

/**
 * Read the plan of the cut before anything is cut: which sections the stored note has and
 * how many requests they will take. Costs no AI call, so the dialog can show the person
 * the whole list of steps before the first one starts.
 */
export async function fetchNoteCutOutline(noteId: string): Promise<NoteCutOutline> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`${API_BASE}/api/studies/notes/${noteId}/cut`, {
    method: 'GET',
    headers: authHeaders,
    category: 'detail',
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Failed to read the study note (${response.status})`;
    throw new CutStudyNoteError(message, response.status, null);
  }
  const body = payload as Partial<NoteCutOutline> | null;
  const slices = Array.isArray(body?.slices) ? body.slices.filter((slice) => slice && slice.limit > 0) : [];
  if (!body || slices.length === 0) {
    throw new CutStudyNoteError('The note has nothing to cut', 400);
  }
  return {
    noteId: typeof body.noteId === 'string' && body.noteId ? body.noteId : noteId,
    words: typeof body.words === 'number' ? body.words : 0,
    totalSections: typeof body.totalSections === 'number' ? body.totalSections : slices.length,
    sections: Array.isArray(body.sections) ? body.sections : [],
    slices,
    corridor: body.corridor ?? { min: 0, max: 0 },
  };
}

/** A failed cut, carrying what the dialog needs to say the right thing. */
export class CutStudyNoteError extends Error {
  readonly status: number;
  readonly usageCap: UsageCapReachedError | null;

  constructor(message: string, status: number, usageCap: UsageCapReachedError | null = null) {
    super(message);
    this.name = 'CutStudyNoteError';
    this.status = status;
    this.usageCap = usageCap;
  }
}

/**
 * Cut a saved study note into atomic scratch notes. Server-side and online-only: the
 * model reads the STORED note, so unsaved edits in the editor are not part of the cut.
 * Nothing is written by this call; the caller puts the atoms where they belong.
 */
export async function cutStudyNoteIntoScratch(
  noteId: string,
  slice?: { offset: number; limit: number }
): Promise<CutStudyNoteResponse> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`${API_BASE}/api/studies/notes/${noteId}/cut`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    category: 'ai',
    // No slice means the whole note, which is what a short note gets anyway.
    body: JSON.stringify(slice ?? {}),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const usageCap = response.status === 429 ? parseUsageCapError(payload) : null;
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Failed to cut the study note (${response.status})`;
    throw new CutStudyNoteError(message, response.status, usageCap);
  }
  const body = payload as Partial<CutStudyNoteResponse> | null;
  if (!body || !Array.isArray(body.notes)) {
    throw new CutStudyNoteError('The cut answered without scratch notes', 500);
  }
  // Only well-formed atoms reach the sermon: a proxy or a version-skewed server must not be
  // able to seed the pool with shapes the board cannot render.
  const notes = body.notes.filter(
    (note): note is ScratchNote =>
      !!note &&
      typeof note === 'object' &&
      typeof note.id === 'string' &&
      note.id.length > 0 &&
      typeof note.text === 'string' &&
      note.text.trim().length > 0 &&
      typeof note.createdAt === 'string'
  );
  if (notes.length === 0) {
    throw new CutStudyNoteError('The cut answered without usable scratch notes', 422);
  }
  return {
    noteId: typeof body.noteId === 'string' && body.noteId ? body.noteId : noteId,
    keyPassage: typeof body.keyPassage === 'string' ? body.keyPassage : '',
    sections: Array.isArray(body.sections) ? body.sections : [],
    notes,
    totalSections: typeof body.totalSections === 'number' ? body.totalSections : 0,
  };
}

export async function deleteStudyNote(id: string, userId: string): Promise<void> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const res = await fetch(`${API_BASE}/api/studies/notes/${id}?userId=${userId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  if (!res.ok) {
    console.error('deleteStudyNote: failed', res.status);
    throw new Error('Failed to delete study note');
  }
}
