import * as shareNotesRoute from 'app/api/share/notes/[token]/route';

import { studiesRepository } from '@repositories/studies.repository';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

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

jest.mock('@repositories/studies.repository', () => ({
  studiesRepository: {
    getNote: jest.fn(),
  },
}));

jest.mock('@repositories/studyNoteShareLinks.repository', () => ({
  studyNoteShareLinksRepository: {
    findByToken: jest.fn(),
    incrementViewCount: jest.fn(),
  },
}));

const mockStudiesRepo = studiesRepository as jest.Mocked<typeof studiesRepository>;
const mockShareLinksRepo = studyNoteShareLinksRepository as jest.Mocked<typeof studyNoteShareLinksRepository>;

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
    mockShareLinksRepo.findByToken.mockResolvedValue(null as any);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });

  it('returns 404 when note not found', async () => {
    mockShareLinksRepo.findByToken.mockResolvedValue({ id: 'link-1', noteId: 'note-1' } as any);
    mockStudiesRepo.getNote.mockResolvedValue(null as any);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });

  it('increments view count when no cookie', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockShareLinksRepo.findByToken.mockResolvedValue({ id: 'link-1', noteId: 'note-1' } as any);
    mockStudiesRepo.getNote.mockResolvedValue({ content: 'Hello' } as any);

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(mockShareLinksRepo.incrementViewCount).toHaveBeenCalledWith('link-1');
    expect(response.cookies.set).toHaveBeenCalled();
    expect(data.content).toBe('Hello');
    nowSpy.mockRestore();
  });

  it('skips increment when cookie is recent', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockShareLinksRepo.findByToken.mockResolvedValue({ id: 'link-1', noteId: 'note-1' } as any);
    mockStudiesRepo.getNote.mockResolvedValue({ content: 'Hello' } as any);

    const response = await shareNotesRoute.GET(makeRequest(String(1_000_000)), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(mockShareLinksRepo.incrementViewCount).not.toHaveBeenCalled();
    expect(response.cookies.set).not.toHaveBeenCalled();
    expect(data.content).toBe('Hello');
    nowSpy.mockRestore();
  });

  it('returns 500 on unexpected error', async () => {
    mockShareLinksRepo.findByToken.mockRejectedValue(new Error('boom'));

    const response = await shareNotesRoute.GET(makeRequest(), { params: Promise.resolve({ token: 'token-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load shared note');
  });
});
