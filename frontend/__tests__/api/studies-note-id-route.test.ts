import * as route from 'app/api/studies/notes/[id]/route';

import { studiesRepository } from '@repositories/studies.repository';

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
    deleteNote: jest.fn(),
  },
}));

const mockRepo = studiesRepository as jest.Mocked<typeof studiesRepository>;

const makeRequest = (userId?: string, method = 'GET') =>
  new Request(
    userId
      ? `https://example.com/api/studies/notes/note-1?userId=${userId}`
      : 'https://example.com/api/studies/notes/note-1',
    {
      method,
    }
  );

const params = { params: Promise.resolve({ id: 'note-1' }) };

describe('studies notes [id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 401 when userId is missing', async () => {
      const response = await route.GET(makeRequest(), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns 404 when note does not exist', async () => {
      mockRepo.getNote.mockResolvedValue(null as any);

      const response = await route.GET(makeRequest('user-1'), params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not found');
    });

    it('returns 403 when note belongs to another user', async () => {
      mockRepo.getNote.mockResolvedValue({ userId: 'user-2' } as any);

      const response = await route.GET(makeRequest('user-1'), params);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });

    it('returns note when owner matches', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1', title: 'Note' } as any);

      const response = await route.GET(makeRequest('user-1'), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('note-1');
      expect(mockRepo.getNote).toHaveBeenCalledWith('note-1');
    });

    it('returns 500 when repository throws', async () => {
      mockRepo.getNote.mockRejectedValue(new Error('boom'));

      const response = await route.GET(makeRequest('user-1'), params);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to load study note');
    });
  });

  describe('DELETE', () => {
    it('returns 401 when userId is missing', async () => {
      const response = await route.DELETE(makeRequest(undefined, 'DELETE'), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns success when note does not exist', async () => {
      mockRepo.getNote.mockResolvedValue(null as any);

      const response = await route.DELETE(makeRequest('user-1', 'DELETE'), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns 403 when note belongs to another user', async () => {
      mockRepo.getNote.mockResolvedValue({ userId: 'user-2' } as any);

      const response = await route.DELETE(makeRequest('user-1', 'DELETE'), params);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });

    it('deletes note when owner matches', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);

      const response = await route.DELETE(makeRequest('user-1', 'DELETE'), params);
      const data = await response.json();

      expect(mockRepo.deleteNote).toHaveBeenCalledWith('note-1');
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns 500 when delete fails', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);
      mockRepo.deleteNote.mockRejectedValue(new Error('boom'));

      const response = await route.DELETE(makeRequest('user-1', 'DELETE'), params);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete study note');
    });
  });
});
