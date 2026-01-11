import { StudyNoteShareLink } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export async function getStudyNoteShareLinks(userId: string): Promise<StudyNoteShareLink[]> {
  const res = await fetch(`${API_BASE}/api/studies/share-links?userId=${userId}`, { cache: 'no-store' });
  if (!res.ok) {
    console.error('getStudyNoteShareLinks: failed', res.status);
    throw new Error('Failed to fetch share links');
  }
  return res.json();
}

export async function createStudyNoteShareLink(userId: string, noteId: string): Promise<StudyNoteShareLink> {
  const res = await fetch(`${API_BASE}/api/studies/share-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, noteId }),
  });
  if (!res.ok) {
    console.error('createStudyNoteShareLink: failed', res.status);
    throw new Error('Failed to create share link');
  }
  return res.json();
}

export async function deleteStudyNoteShareLink(userId: string, linkId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/studies/share-links/${linkId}?userId=${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    console.error('deleteStudyNoteShareLink: failed', res.status);
    throw new Error('Failed to delete share link');
  }
}
