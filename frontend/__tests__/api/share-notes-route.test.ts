import * as shareNotesRoute from 'app/api/share/notes/[token]/route';

import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';
import { recordSharedNoteView } from '@/data-engine/serverOperations.server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init: { status?: number; headers?: Record<string, string> } = {}) => ({
      status: init.status ?? 200,
      headers: init.headers,
      json: async () => data,
      data,
      cookies: { set: jest.fn() },
    })),
  },
}));

jest.mock('@repositories/studyNoteShareLinks.repository', () => ({
  studyNoteShareLinksRepository: {
    readSharedNote: jest.fn(),
  },
}));
jest.mock('@/data-engine/serverOperations.server', () => ({ recordSharedNoteView: jest.fn() }));

const mockShareLinksRepo = studyNoteShareLinksRepository as jest.Mocked<typeof studyNoteShareLinksRepository>;
const mockRecordSharedNoteView = recordSharedNoteView as jest.MockedFunction<typeof recordSharedNoteView>;

describe('share notes route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeRequest = (cookieValue?: string) => ({
    cookies: {
      get: jest.fn().mockReturnValue(cookieValue ? { value: cookieValue } : undefined),
    },
  }) as any;

  it('returns 404 when share link not found', async () => {
    mockShareLinksRepo.readSharedNote.mockResolvedValue(null as any);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
    expect(mockRecordSharedNoteView).not.toHaveBeenCalled();
  });

  it('returns 404 when note not found', async () => {
    mockShareLinksRepo.readSharedNote.mockResolvedValue(null);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
    expect(mockRecordSharedNoteView).not.toHaveBeenCalled();
  });

  it('records a view when no cookie and sets the 24-hour token cookie', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockShareLinksRepo.readSharedNote.mockResolvedValue({ shareLink: { id: 'link-1', noteId: 'note-1', ownerId: 'owner' }, content: 'Hello' } as any);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(mockRecordSharedNoteView).toHaveBeenCalledWith('link-1', 'token-1');
    expect(response.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'share_note_viewed_token-1', value: '1000000', maxAge: 86_400, httpOnly: true, sameSite: 'lax', path: '/',
    }));
    expect(data.content).toBe('Hello');
    nowSpy.mockRestore();
  });

  it('records a view when the prior cookie reaches the 24-hour expiry', async () => {
    const now = 1_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockShareLinksRepo.readSharedNote.mockResolvedValue({ shareLink: { id: 'link-1', noteId: 'note-1', ownerId: 'owner' }, content: 'Hello' } as any);

    const response = await shareNotesRoute.GET(makeRequest(String(now - 86_400_000)), { params: Promise.resolve({ token: 'token-1' }) });

    expect(mockRecordSharedNoteView).toHaveBeenCalledWith('link-1', 'token-1');
    expect(response.cookies.set).toHaveBeenCalledWith(expect.objectContaining({ value: String(now), maxAge: 86_400 }));
    nowSpy.mockRestore();
  });

  it('skips recording a view when the token cookie is recent', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockShareLinksRepo.readSharedNote.mockResolvedValue({ shareLink: { id: 'link-1', noteId: 'note-1', ownerId: 'owner' }, content: 'Hello' } as any);

    const response = await shareNotesRoute.GET(makeRequest(String(1_000_000)), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(mockRecordSharedNoteView).not.toHaveBeenCalled();
    expect(response.cookies.set).not.toHaveBeenCalled();
    expect(data.content).toBe('Hello');
    nowSpy.mockRestore();
  });

  it('returns the note title and passages alongside the text, and nothing about the link', async () => {
    const passage = { id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17 };
    mockShareLinksRepo.readSharedNote.mockResolvedValue({
      shareLink: { id: 'link-1', noteId: 'note-1', ownerId: 'owner' },
      content: 'Hello',
      title: 'Faith',
      scriptureRefs: [passage],
      type: 'note',
    } as any);

    const response = await shareNotesRoute.GET(makeRequest(String(Date.now())), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(data).toEqual({ content: 'Hello', title: 'Faith', scriptureRefs: [passage] });
  });

  it('returns 500 on unexpected error', async () => {
    mockShareLinksRepo.readSharedNote.mockRejectedValue(new Error('boom'));

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load shared note');
  });
});
