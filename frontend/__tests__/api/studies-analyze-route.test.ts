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

const request = (body: unknown, headers: Record<string, string> = {}) => ({
  json: jest.fn().mockResolvedValue(body),
  headers: new Headers(headers),
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

  // The owner, 2026-10-17: a note's old references are read in the Bible of its author's interface. The
  // author's request says it; the stored note is read in it.
  it('reads the note in the language the author’s interface sent', async () => {
    const response = await POST(request({ studyId: 'study-1', content: 'Study content', existingTags: [], analysisType: 'all' }, { 'x-app-language': 'uk' }));
    expect(response.status).toBe(200);
    expect(studiesRepository.getNote).toHaveBeenCalledWith('study-1', 'uk');
  });

  it('meters analysis against the authenticated owner (the caller), not a body-supplied identity', async () => {
    const response = await POST(request({
      studyId: 'study-1',
      content: 'Study content',
      existingTags: ['Grace'],
      analysisType: 'all',
    }));

    expect(response.status).toBe(200);
    expect(studiesRepository.getNote).toHaveBeenCalledWith('study-1', undefined);
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
