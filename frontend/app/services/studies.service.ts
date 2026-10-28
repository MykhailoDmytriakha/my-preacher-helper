import { collection, getDocs, query, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { ScratchNote, StudyNote } from '@/models/models';
import { readOwnerList } from '@/services/ownerListRead.client';
import { parseUsageCapError, type UsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { isStudyNoteDraft } from '@/utils/studyNoteDraft';

// Study notes are written only through the data engine (engineOwnedCollections.ts). What stays
// here is the note list read the sermon side still uses and the AI cut routes.
/** The note body is one editable unit; server-side links (materialIds) are not. */
export const NOTE_AGGREGATE = 'note';

const NOTES_COLLECTION = 'studyNotes';

type NoteFilters = Partial<{
  q: string;
  tag: string;
  book: string;
  chapter: number;
  draftOnly: boolean;
}>;

// --- helpers mirroring studies.repository.ts + the GET route's filterNotes ---

// The one draft rule of the server and the device (`utils/studyNoteDraft.ts`): a comment is never a draft.
const computeDraft = (note: Pick<StudyNote, 'tags' | 'scriptureRefs' | 'type'>): boolean => isStudyNoteDraft(note);

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

/** The same shaping for both roads. */
const shapeNotes = (documents: Record<string, unknown>[]): StudyNote[] =>
  documents.map((data) => normalizeNote(data as unknown as StudyNote));

async function readNotesViaSdk(userId: string): Promise<StudyNote[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, NOTES_COLLECTION), where('userId', '==', userId)));
  return shapeNotes(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

/* Same class as series and groups: one road, no deadline — see `series.service.ts`. */
async function getStudyNotesViaClient(userId: string, filters: NoteFilters): Promise<StudyNote[]> {
  const notes = await readOwnerList(NOTES_COLLECTION, userId, readNotesViaSdk(userId), shapeNotes);
  return filterNotesClient(notes, filters);
}

export async function getStudyNotes(userId: string, filters: NoteFilters = {}): Promise<StudyNote[]> {
  return getStudyNotesViaClient(userId, filters);
}

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
  const response = await apiClient(`/api/studies/notes/${noteId}/cut`, {
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
  const response = await apiClient(`/api/studies/notes/${noteId}/cut`, {
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
