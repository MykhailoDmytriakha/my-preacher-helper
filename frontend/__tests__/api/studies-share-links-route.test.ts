import * as shareLinksRoute from 'app/api/studies/share-links/route';

import { studiesRepository } from '@repositories/studies.repository';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init: { status?: number } = {}) => ({
      status: init.status ?? 200,
      json: async () => data,
      data,
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
    listByOwner: jest.fn(),
    findByOwnerAndNoteId: jest.fn(),
    createLink: jest.fn(),
  },
}));

const mockStudiesRepo = studiesRepository as jest.Mocked<typeof studiesRepository>;
const mockShareLinksRepo = studyNoteShareLinksRepository as jest.Mocked<typeof studyNoteShareLinksRepository>;

describe('studies share-links route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 401 when userId is missing', async () => {
      const req = { url: 'https://example.com/api/studies/share-links' } as Request;

      const response = await shareLinksRoute.GET(req);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns share links for user', async () => {
      const links = [{ id: 'link-1' }];
      mockShareLinksRepo.listByOwner.mockResolvedValue(links as any);
      const req = { url: 'https://example.com/api/studies/share-links?userId=user-1' } as Request;

      const response = await shareLinksRoute.GET(req);
      const data = await response.json();

      expect(mockShareLinksRepo.listByOwner).toHaveBeenCalledWith('user-1');
      expect(response.status).toBe(200);
      expect(data).toEqual(links);
    });

    it('returns 500 on repository error', async () => {
      mockShareLinksRepo.listByOwner.mockRejectedValue(new Error('boom'));
      const req = { url: 'https://example.com/api/studies/share-links?userId=user-1' } as Request;

      const response = await shareLinksRoute.GET(req);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch share links');
    });
  });

  describe('POST', () => {
    const makeRequest = (body: Record<string, unknown>) => ({
      url: 'https://example.com/api/studies/share-links',
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Request;

    it('returns 401 when userId missing', async () => {
      const response = await shareLinksRoute.POST(makeRequest({ noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns 400 when noteId missing', async () => {
      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1' }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('noteId is required');
    });

    it('returns 404 when note not found', async () => {
      mockStudiesRepo.getNote.mockResolvedValue(null as any);

      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1', noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Study note not found');
    });

    it('returns 403 when note belongs to different user', async () => {
      mockStudiesRepo.getNote.mockResolvedValue({ userId: 'user-2' } as any);

      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1', noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });

    it('returns existing link if already created', async () => {
      mockStudiesRepo.getNote.mockResolvedValue({ userId: 'user-1' } as any);
      mockShareLinksRepo.findByOwnerAndNoteId.mockResolvedValue({ id: 'link-1' } as any);

      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1', noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('link-1');
      expect(mockShareLinksRepo.createLink).not.toHaveBeenCalled();
    });

    it('creates a new link when missing', async () => {
      mockStudiesRepo.getNote.mockResolvedValue({ userId: 'user-1' } as any);
      mockShareLinksRepo.findByOwnerAndNoteId.mockResolvedValue(null as any);
      mockShareLinksRepo.createLink.mockResolvedValue({ id: 'link-2' } as any);

      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1', noteId: 'note-1' }));
      const data = await response.json();

      expect(mockShareLinksRepo.createLink).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'user-1', noteId: 'note-1', token: expect.any(String) })
      );
      expect(response.status).toBe(201);
      expect(data.id).toBe('link-2');
    });

    it('returns 500 on unexpected error', async () => {
      mockStudiesRepo.getNote.mockRejectedValue(new Error('boom'));

      const response = await shareLinksRoute.POST(makeRequest({ userId: 'user-1', noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create share link');
    });
  });
});
