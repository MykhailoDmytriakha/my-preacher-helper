import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { StudyMaterial, StudyNote } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Study-note reads, create, and content updates use the client Firestore SDK.
// DELETE stays on the server because it cascades into studyMaterials, and study
// materials + share links stay on the server.
const NOTES_COLLECTION = 'studyNotes';

// Fields a client UPDATE may touch — the user-editable note content only. Never
// userId/id/createdAt/materialIds (materialIds is kept in sync by the server-side
// material<->note linking). updatedAt + isDraft are derived and set here.
const STUDY_NOTE_UPDATE_FIELDS: (keyof StudyNote)[] = [
  'title', 'content', 'scriptureRefs', 'tags', 'type', 'relatedSermonIds',
];

type NoteFilters = Partial<{
  q: string;
  tag: string;
  book: string;
  chapter: number;
  draftOnly: boolean;
}>;

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    search.set(key, String(value));
  });
  return search.toString();
}

// --- helpers mirroring studies.repository.ts + the GET route's filterNotes ---

function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

function normalizeNote(data: StudyNote): StudyNote {
  return {
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

async function updateStudyNoteViaClient(id: string, updates: Partial<StudyNote>): Promise<StudyNote> {
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
  await updateDoc(ref, cleanUpdates);
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

export async function updateStudyNote(id: string, updates: Partial<StudyNote> & { userId: string }): Promise<StudyNote> {
  return updateStudyNoteViaClient(id, updates);
}

export async function deleteStudyNote(id: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/studies/notes/${id}?userId=${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    console.error('deleteStudyNote: failed', res.status);
    throw new Error('Failed to delete study note');
  }
}

export async function getStudyMaterials(userId: string): Promise<StudyMaterial[]> {
  const query = buildQuery({ userId });
  const res = await fetch(`${API_BASE}/api/studies/materials?${query}`, { cache: 'no-store' });
  if (!res.ok) {
    console.error('getStudyMaterials: failed', res.status);
    throw new Error('Failed to fetch study materials');
  }
  return res.json();
}

export async function createStudyMaterial(material: Omit<StudyMaterial, 'id' | 'createdAt' | 'updatedAt'>): Promise<StudyMaterial> {
  const res = await fetch(`${API_BASE}/api/studies/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(material),
  });
  if (!res.ok) {
    console.error('createStudyMaterial: failed', res.status);
    throw new Error('Failed to create study material');
  }
  return res.json();
}

export async function updateStudyMaterial(id: string, updates: Partial<StudyMaterial> & { userId: string }): Promise<StudyMaterial> {
  const res = await fetch(`${API_BASE}/api/studies/materials/${id}?userId=${updates.userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error('updateStudyMaterial: failed', res.status);
    throw new Error('Failed to update study material');
  }
  return res.json();
}

export async function deleteStudyMaterial(id: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/studies/materials/${id}?userId=${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    console.error('deleteStudyMaterial: failed', res.status);
    throw new Error('Failed to delete study material');
  }
}
