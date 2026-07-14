import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { POST } from '@/api/studies/analyze/route';
import { analyzeStudyNote } from '@clients/studyNote.structured';
import { studiesRepository } from '@repositories/studies.repository';

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

jest.mock('@clients/studyNote.structured', () => ({
  analyzeStudyNote: jest.fn(),
}));

jest.mock('@repositories/studies.repository', () => ({
  studiesRepository: { getNote: jest.fn() },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, options: { status?: number } = {}) => ({
      status: options.status ?? 200,
      json: async () => data,
    })),
  },
}));

const mockGetUid = getRequiredAuthenticatedUid as jest.Mock;

const request = (body: unknown) => ({
  json: jest.fn().mockResolvedValue(body),
} as unknown as Request);

describe('POST /api/studies/analyze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUid.mockResolvedValue('study-owner-1');
    (studiesRepository.getNote as jest.Mock).mockResolvedValue({
      id: 'study-1',
      userId: 'study-owner-1',
    });
    (analyzeStudyNote as jest.Mock).mockResolvedValue({
      success: true,
      data: { title: 'Title', scriptureRefs: [], tags: [] },
      error: null,
    });
  });

  it('meters analysis against the authenticated owner (the caller), not a body-supplied identity', async () => {
    const response = await POST(request({
      studyId: 'study-1',
      content: 'Study content',
      existingTags: ['Grace'],
      analysisType: 'all',
    }));

    expect(response.status).toBe(200);
    expect(studiesRepository.getNote).toHaveBeenCalledWith('study-1');
    expect(analyzeStudyNote).toHaveBeenCalledWith(
      'Study content',
      ['Grace'],
      'all',
      'study-owner-1'
    );
  });

  it('rejects an unauthenticated caller before any DB or AI access', async () => {
    mockGetUid.mockResolvedValue(null);
    const response = await POST(request({ studyId: 'study-1', content: 'Study content' }));

    expect(response.status).toBe(401);
    expect(studiesRepository.getNote).not.toHaveBeenCalled();
    expect(analyzeStudyNote).not.toHaveBeenCalled();
  });

  it('rejects a caller who does not own the study (no cross-user billing)', async () => {
    mockGetUid.mockResolvedValue('attacker-uid');
    const response = await POST(request({ studyId: 'study-1', content: 'Study content' }));

    expect(response.status).toBe(403);
    expect(analyzeStudyNote).not.toHaveBeenCalled();
  });

  it('analyzes an unsaved draft (studyId "new") without a server round-trip, metered to the caller', async () => {
    const response = await POST(request({ studyId: 'new', content: 'Study content' }));

    // A fresh note the user is typing has no saved resource yet; analysis must still
    // run (billed to the authenticated caller) instead of 400-locking the owner out.
    expect(response.status).toBe(200);
    expect(studiesRepository.getNote).not.toHaveBeenCalled();
    expect(analyzeStudyNote).toHaveBeenCalledWith('Study content', undefined, undefined, 'study-owner-1');
  });

  it('analyzes an optimistically-created note that is not yet server-visible (getNote null → allowed)', async () => {
    // create is fire-and-forget: the client id may not be persisted server-side yet.
    (studiesRepository.getNote as jest.Mock).mockResolvedValue(null);
    const response = await POST(request({ studyId: 'client-optimistic-id', content: 'Study content' }));

    expect(response.status).toBe(200);
    expect(analyzeStudyNote).toHaveBeenCalledWith('Study content', undefined, undefined, 'study-owner-1');
  });
});
