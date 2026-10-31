import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

import type { StudyNoteShareLink } from '@/models/models';

const transportMessages = {
  timedOut: 'Share-link request timed out',
  unavailable: 'Share-link service unavailable',
};

export async function getStudyNoteShareLinks(userId: string): Promise<StudyNoteShareLink[]> {
  const { value } = await requestOwnerJson<StudyNoteShareLink[]>(`/api/studies/share-links?userId=${userId}`, {
    method: 'GET', expectedOwner: userId, category: 'metadata', answerStatuses: [],
    messages: { ...transportMessages, failed: 'Failed to fetch share links' },
  });
  return value;
}

export async function createStudyNoteShareLink(userId: string, noteId: string): Promise<StudyNoteShareLink> {
  const { value } = await requestOwnerJson<StudyNoteShareLink>('/api/studies/share-links', {
    method: 'POST', expectedOwner: userId, payload: { userId, noteId }, answerStatuses: [],
    messages: { ...transportMessages, failed: 'Failed to create share link' },
  });
  return value;
}

export async function deleteStudyNoteShareLink(userId: string, linkId: string): Promise<void> {
  await requestOwnerJson(`/api/studies/share-links/${linkId}?userId=${userId}`, {
    method: 'DELETE', expectedOwner: userId, answerStatuses: [],
    messages: { ...transportMessages, failed: 'Failed to delete share link' },
  });
}
