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
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
  },
}));

const mockRepo = studiesRepository as jest.Mocked<typeof studiesRepository>;

const makeRequest = (userId?: string, method = 'GET', body?: unknown) =>
  new Request(
    userId
      ? `https://example.com/api/studies/notes/note-1?userId=${userId}`
      : 'https://example.com/api/studies/notes/note-1',
    {
      method,
      body: body ? JSON.stringify(body) : undefined,
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

  describe('PUT', () => {
    it('returns 401 when userId is missing', async () => {
      const response = await route.PUT(makeRequest(undefined, 'PUT', { title: 'Updated' }), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns 404 when note does not exist', async () => {
      mockRepo.getNote.mockResolvedValue(null as any);

      const response = await route.PUT(makeRequest('user-1', 'PUT', { title: 'Updated' }), params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not found');
    });

    it('returns 403 when note belongs to another user', async () => {
      mockRepo.getNote.mockResolvedValue({ userId: 'user-2' } as any);

      const response = await route.PUT(makeRequest('user-1', 'PUT', { title: 'Updated' }), params);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });

    it('returns 400 when payload attempts to change userId', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);

      const response = await route.PUT(
        makeRequest('user-1', 'PUT', { title: 'Updated', userId: 'user-2' }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot change userId');
      expect(mockRepo.updateNote).not.toHaveBeenCalled();
    });

    it('updates note and forces owner to current user', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);
      mockRepo.updateNote.mockResolvedValue({ id: 'note-1', userId: 'user-1', title: 'Updated' } as any);

      const response = await route.PUT(makeRequest('user-1', 'PUT', { title: 'Updated' }), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockRepo.updateNote).toHaveBeenCalledWith('note-1', { title: 'Updated', userId: 'user-1' });
      expect(data.title).toBe('Updated');
    });

    it('returns 500 when update fails', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);
      mockRepo.updateNote.mockRejectedValue(new Error('boom'));

      const response = await route.PUT(makeRequest('user-1', 'PUT', { title: 'Updated' }), params);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to update study note');
    });

    it('strips server-derived fields from the request body', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);
      mockRepo.updateNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);

      await route.PUT(
        makeRequest('user-1', 'PUT', {
          title: 'Updated',
          isDraft: false,
          createdAt: '1999-01-01T00:00:00Z',
          updatedAt: '1999-01-01T00:00:00Z',
          legacyContent: 'spoofed-snapshot',
          arbitraryFromClient: 'should-not-pass',
        }),
        params
      );

      const updateCall = mockRepo.updateNote.mock.calls[0][1];
      expect(updateCall).toEqual({ title: 'Updated', userId: 'user-1' });
      expect(updateCall).not.toHaveProperty('isDraft');
      expect(updateCall).not.toHaveProperty('createdAt');
      expect(updateCall).not.toHaveProperty('legacyContent');
      expect(updateCall).not.toHaveProperty('arbitraryFromClient');
    });

    it('forwards rootNode to repository when present', async () => {
      mockRepo.getNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);
      mockRepo.updateNote.mockResolvedValue({ id: 'note-1', userId: 'user-1' } as any);

      const rootNode = { id: 'root', text: 'hello' };
      await route.PUT(
        makeRequest('user-1', 'PUT', { rootNode, title: 'T' }),
        params
      );

      expect(mockRepo.updateNote).toHaveBeenCalledWith('note-1', {
        rootNode,
        title: 'T',
        userId: 'user-1',
      });
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
