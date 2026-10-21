import { StudyNoteShareLink } from '@/models/models';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

export async function getStudyNoteShareLinks(userId: string): Promise<StudyNoteShareLink[]> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const res = await apiClient(`/api/studies/share-links?userId=${userId}`, { category: 'metadata',
    cache: 'no-store',
    headers: authHeaders,
  });
  if (!res.ok) {
    console.error('getStudyNoteShareLinks: failed', res.status);
    throw new Error('Failed to fetch share links');
  }
  return res.json();
}

export async function createStudyNoteShareLink(userId: string, noteId: string): Promise<StudyNoteShareLink> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const res = await apiClient('/api/studies/share-links', { category: 'crud',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ userId, noteId }),
  });
  if (!res.ok) {
    console.error('createStudyNoteShareLink: failed', res.status);
    throw new Error('Failed to create share link');
  }
  return res.json();
}

export async function deleteStudyNoteShareLink(userId: string, linkId: string): Promise<void> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const res = await apiClient(`/api/studies/share-links/${linkId}?userId=${userId}`, { category: 'crud',
    method: 'DELETE',
    headers: authHeaders,
  });
  if (!res.ok) {
    console.error('deleteStudyNoteShareLink: failed', res.status);
    throw new Error('Failed to delete share link');
  }
}
