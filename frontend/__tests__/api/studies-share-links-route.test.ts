import * as shareLinksRoute from 'app/api/studies/share-links/route';

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

jest.mock('@repositories/studyNoteShareLinks.repository', () => ({
  studyNoteShareLinksRepository: {
    listByOwner: jest.fn(),
    findByOwnerAndNoteId: jest.fn(),
  },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn((request: Request) =>
    Promise.resolve(new URL(request.url).searchParams.get('userId'))
  ),
}));

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
      url: body.userId
        ? `https://example.com/api/studies/share-links?userId=${String(body.userId)}`
        : 'https://example.com/api/studies/share-links',
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Request;

    it('returns 401 when userId missing', async () => {
      const response = await shareLinksRoute.POST(makeRequest({ noteId: 'note-1' }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
      expect(mockShareLinksRepo.findByOwnerAndNoteId).not.toHaveBeenCalled();
    });

    it('returns the authenticated data-engine-required refusal without calling a legacy writer', async () => {
      const request = makeRequest({ userId: 'user-1', noteId: 'note-1' });
      const response = await shareLinksRoute.POST(request);
      const data = await response.json();

      expect(response.status).toBe(426);
      expect(data).toEqual({ code: 'data-engine-required', error: 'data-engine-required' });
      expect(mockShareLinksRepo.findByOwnerAndNoteId).not.toHaveBeenCalled();
    });
  });
});
