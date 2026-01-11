import * as shareLinkRoute from 'app/api/studies/share-links/[id]/route';

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
    getById: jest.fn(),
    deleteLink: jest.fn(),
  },
}));

const mockRepo = studyNoteShareLinksRepository as jest.Mocked<typeof studyNoteShareLinksRepository>;

describe('studies share-links [id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeRequest = (userId?: string) => ({
    url: userId
      ? `https://example.com/api/studies/share-links/link-1?userId=${userId}`
      : 'https://example.com/api/studies/share-links/link-1',
  }) as Request;

  it('returns 401 when userId missing', async () => {
    const response = await shareLinkRoute.DELETE(makeRequest(), { params: Promise.resolve({ id: 'link-1' }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('User not authenticated');
  });

  it('returns success when link does not exist', async () => {
    mockRepo.getById.mockResolvedValue(null as any);

    const response = await shareLinkRoute.DELETE(makeRequest('user-1'), { params: Promise.resolve({ id: 'link-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('returns 403 when owner mismatch', async () => {
    mockRepo.getById.mockResolvedValue({ ownerId: 'user-2' } as any);

    const response = await shareLinkRoute.DELETE(makeRequest('user-1'), { params: Promise.resolve({ id: 'link-1' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Forbidden');
  });

  it('deletes link when owner matches', async () => {
    mockRepo.getById.mockResolvedValue({ ownerId: 'user-1' } as any);

    const response = await shareLinkRoute.DELETE(makeRequest('user-1'), { params: Promise.resolve({ id: 'link-1' }) });
    const data = await response.json();

    expect(mockRepo.deleteLink).toHaveBeenCalledWith('link-1');
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('returns 500 on unexpected error', async () => {
    mockRepo.getById.mockRejectedValue(new Error('boom'));

    const response = await shareLinkRoute.DELETE(makeRequest('user-1'), { params: Promise.resolve({ id: 'link-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to delete share link');
  });
});
