import { StudyNoteShareLink } from '@/models/models';

const mockFetch = jest.fn();
global.fetch = mockFetch;

// All successful fixtures are authenticated as their payload owner.
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'user-1' }));

let getStudyNoteShareLinks: typeof import('@/services/studyNoteShareLinks.service').getStudyNoteShareLinks;
let createStudyNoteShareLink: typeof import('@/services/studyNoteShareLinks.service').createStudyNoteShareLink;
let deleteStudyNoteShareLink: typeof import('@/services/studyNoteShareLinks.service').deleteStudyNoteShareLink;

describe('studyNoteShareLinks.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    const service = await import('@/services/studyNoteShareLinks.service');
    getStudyNoteShareLinks = service.getStudyNoteShareLinks;
    createStudyNoteShareLink = service.createStudyNoteShareLink;
    deleteStudyNoteShareLink = service.deleteStudyNoteShareLink;
  });

  it('fetches share links for a user', async () => {
    const links: StudyNoteShareLink[] = [
      {
        id: 'link-1',
        ownerId: 'user-1',
        noteId: 'note-1',
        token: 'token-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        viewCount: 2,
      },
    ];
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(links),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const result = await getStudyNoteShareLinks('user-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links?userId=user-1', expect.objectContaining({
      cache: 'no-store',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
    expect(result).toEqual(links);
  });

  it('throws when fetching share links fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(getStudyNoteShareLinks('user-1')).rejects.toMatchObject({ message: 'Failed to fetch share links', code: 'unavailable' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('creates a share link', async () => {
    const link: StudyNoteShareLink = {
      id: 'link-1',
      ownerId: 'user-1',
      noteId: 'note-1',
      token: 'token-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      viewCount: 0,
    };
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(link),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const result = await createStudyNoteShareLink('user-1', 'note-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ userId: 'user-1', noteId: 'note-1' }),
    }));
    expect(result).toEqual(link);
  });

  it('throws when creating a share link fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });

    await expect(createStudyNoteShareLink('user-1', 'note-1')).rejects.toMatchObject({ message: 'Failed to create share link', code: 'invalid-argument' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('deletes a share link', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });

    await deleteStudyNoteShareLink('user-1', 'link-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links/link-1?userId=user-1', expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
  });

  it('throws when deleting a share link fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    await expect(deleteStudyNoteShareLink('user-1', 'link-1')).rejects.toMatchObject({ message: 'Failed to delete share link', code: 'permission-denied' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
jest.mock('@/utils/authenticatedRequest', () => ({ ...jest.requireActual('@/utils/authenticatedRequest'),
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));
