import { StudyMaterial, StudyNote, StudyNoteBranchState } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

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

export async function getStudyNotes(userId: string, filters: NoteFilters = {}): Promise<StudyNote[]> {
  const query = buildQuery({ userId, ...filters });
  const res = await fetch(`${API_BASE}/api/studies/notes?${query}`, { cache: 'no-store' });
  if (!res.ok) {
    console.error('getStudyNotes: failed', res.status);
    throw new Error('Failed to fetch study notes');
  }
  return res.json();
}

export async function createStudyNote(note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>): Promise<StudyNote> {
  const res = await fetch(`${API_BASE}/api/studies/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!res.ok) {
    console.error('createStudyNote: failed', res.status);
    throw new Error('Failed to create study note');
  }
  return res.json();
}

export async function updateStudyNote(id: string, updates: Partial<StudyNote> & { userId: string }): Promise<StudyNote> {
  const res = await fetch(`${API_BASE}/api/studies/notes/${id}?userId=${updates.userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error('updateStudyNote: failed', res.status);
    throw new Error('Failed to update study note');
  }
  return res.json();
}

export async function deleteStudyNote(id: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/studies/notes/${id}?userId=${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    console.error('deleteStudyNote: failed', res.status);
    throw new Error('Failed to delete study note');
  }
}

export async function getStudyNoteBranchState(
  noteId: string,
  userId: string
): Promise<StudyNoteBranchState | null> {
  const res = await fetch(`${API_BASE}/api/studies/notes/${noteId}/branch-state?userId=${userId}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    console.error('getStudyNoteBranchState: failed', res.status);
    throw new Error('Failed to fetch study note branch state');
  }
  return res.json();
}

export async function getStudyNoteBranchStates(userId: string): Promise<StudyNoteBranchState[]> {
  const query = buildQuery({ userId });
  const res = await fetch(`${API_BASE}/api/studies/notes/branch-states?${query}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    console.error('getStudyNoteBranchStates: failed', res.status);
    throw new Error('Failed to fetch study note branch states');
  }
  return res.json();
}

export async function updateStudyNoteBranchState(
  noteId: string,
  userId: string,
  updates: Pick<StudyNoteBranchState, 'branchRecords' | 'readFoldedBranchIds' | 'previewFoldedBranchIds'>
): Promise<StudyNoteBranchState> {
  const res = await fetch(`${API_BASE}/api/studies/notes/${noteId}/branch-state?userId=${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error('updateStudyNoteBranchState: failed', res.status);
    throw new Error('Failed to update study note branch state');
  }
  return res.json();
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
