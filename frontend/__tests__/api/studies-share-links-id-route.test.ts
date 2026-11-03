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
  },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn((request: Request) =>
    Promise.resolve(new URL(request.url).searchParams.get('userId'))
  ),
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

  it('returns 401 when userId is missing', async () => {
    const response = await shareLinkRoute.DELETE(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('User not authenticated');
    expect(mockRepo.getById).not.toHaveBeenCalled();
  });

  it('returns the authenticated data-engine-required refusal without calling a legacy writer', async () => {
    const response = await shareLinkRoute.DELETE(makeRequest('user-1'));
    const data = await response.json();

    expect(response.status).toBe(426);
    expect(data).toEqual({ code: 'data-engine-required', error: 'data-engine-required' });
    expect(mockRepo.getById).not.toHaveBeenCalled();
  });
});
