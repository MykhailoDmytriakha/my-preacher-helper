import { StudyNoteShareLink } from '@/models/models';

const mockFetch = jest.fn();
global.fetch = mockFetch;

let getStudyNoteShareLinks: typeof import('@/services/studyNoteShareLinks.service').getStudyNoteShareLinks;
let createStudyNoteShareLink: typeof import('@/services/studyNoteShareLinks.service').createStudyNoteShareLink;
let deleteStudyNoteShareLink: typeof import('@/services/studyNoteShareLinks.service').deleteStudyNoteShareLink;

describe('studyNoteShareLinks.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    process.env.NEXT_PUBLIC_API_BASE = '';
    const service = await import('@/services/studyNoteShareLinks.service');
    getStudyNoteShareLinks = service.getStudyNoteShareLinks;
    createStudyNoteShareLink = service.createStudyNoteShareLink;
    deleteStudyNoteShareLink = service.deleteStudyNoteShareLink;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
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
      json: jest.fn().mockResolvedValue(links),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const result = await getStudyNoteShareLinks('user-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links?userId=user-1', { cache: 'no-store' });
    expect(result).toEqual(links);
  });

  it('throws when fetching share links fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(getStudyNoteShareLinks('user-1')).rejects.toThrow('Failed to fetch share links');

    expect(consoleSpy).toHaveBeenCalledWith('getStudyNoteShareLinks: failed', 500);
    consoleSpy.mockRestore();
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
      json: jest.fn().mockResolvedValue(link),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const result = await createStudyNoteShareLink('user-1', 'note-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', noteId: 'note-1' }),
    });
    expect(result).toEqual(link);
  });

  it('throws when creating a share link fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    await expect(createStudyNoteShareLink('user-1', 'note-1')).rejects.toThrow('Failed to create share link');

    expect(consoleSpy).toHaveBeenCalledWith('createStudyNoteShareLink: failed', 400);
    consoleSpy.mockRestore();
  });

  it('deletes a share link', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await deleteStudyNoteShareLink('user-1', 'link-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studies/share-links/link-1?userId=user-1', {
      method: 'DELETE',
    });
  });

  it('throws when deleting a share link fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    await expect(deleteStudyNoteShareLink('user-1', 'link-1')).rejects.toThrow('Failed to delete share link');

    expect(consoleSpy).toHaveBeenCalledWith('deleteStudyNoteShareLink: failed', 403);
    consoleSpy.mockRestore();
  });
});
