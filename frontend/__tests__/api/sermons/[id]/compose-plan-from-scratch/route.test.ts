import { adminAuth } from '@/config/firebaseAdminConfig';
import { composePlanFromScratch } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

import { POST } from '@/api/sermons/[id]/compose-plan-from-scratch/route';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
  },
}));

jest.mock('@clients/openAI.client', () => ({
  composePlanFromScratch: jest.fn(),
}));

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      headers: options.headers,
      json: async () => data,
    })),
  },
}));

function requestWithToken(token?: string, body?: unknown) {
  return {
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : undefined),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}

async function postWithToken(token?: string, body?: unknown) {
  return POST(requestWithToken(token, body) as never, { params: Promise.resolve({ id: 'sermon-1' }) });
}

describe('compose-plan-from-scratch route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const response = await postWithToken();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'User not authenticated' });
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
    expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user does not own the sermon', async () => {
    (adminAuth.verifyIdToken as jest.Mock).mockResolvedValueOnce({ uid: 'user-1' });
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({
      id: 'sermon-1',
      userId: 'other-user',
      scratch: [],
    });

    const response = await postWithToken('valid-token');
    const body = await response.json();

    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(composePlanFromScratch).not.toHaveBeenCalled();
  });

  it('returns 200 with composed outline for the sermon owner', async () => {
    const outline = {
      introduction: [
        {
          id: 'p1',
          scratchNoteId: 'n1',
          text: 'Intro point',
          source: 'ai' as const,
        },
      ],
      main: [],
      conclusion: [],
    };
    const sermon = {
      id: 'sermon-1',
      userId: 'user-1',
      scratch: [{ id: 'n1', text: 'Intro source', createdAt: '2026-07-04T00:00:00.000Z' }],
      outline: {
        introduction: [{ id: 'existing-intro', text: 'Existing intro point' }],
        main: [],
        conclusion: [],
      },
    };
    (adminAuth.verifyIdToken as jest.Mock).mockResolvedValueOnce({ uid: 'user-1' });
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce(sermon);
    (composePlanFromScratch as jest.Mock).mockResolvedValueOnce({ outline, success: true });

    const response = await postWithToken('valid-token');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(composePlanFromScratch).toHaveBeenCalledWith(sermon, sermon.outline, 'user-1');
    expect(body).toEqual({ outline });
  });

  it('filters scratch notes to requested ids before composing for the sermon owner', async () => {
    const outline = {
      introduction: [],
      main: [
        {
          id: 'p-pooled',
          scratchNoteId: 'pooled-note',
          text: 'Pooled note point',
          source: 'ai' as const,
        },
      ],
      conclusion: [],
    };
    const sermon = {
      id: 'sermon-1',
      userId: 'user-1',
      scratch: [
        { id: 'placed-note', text: 'Already placed source', createdAt: '2026-07-04T00:00:00.000Z' },
        { id: 'pooled-note', text: 'Pooled source', createdAt: '2026-07-04T00:01:00.000Z' },
      ],
      outline: {
        introduction: [],
        main: [{ id: 'existing-main', text: 'Existing main point' }],
        conclusion: [],
      },
    };
    (adminAuth.verifyIdToken as jest.Mock).mockResolvedValueOnce({ uid: 'user-1' });
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce(sermon);
    (composePlanFromScratch as jest.Mock).mockResolvedValueOnce({ outline, success: true });

    const response = await postWithToken('valid-token', {
      existingOutline: sermon.outline,
      scratchNoteIds: ['pooled-note'],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(composePlanFromScratch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sermon-1',
        scratch: [sermon.scratch[1]],
      }),
      sermon.outline,
      'user-1'
    );
    expect(body).toEqual({ outline });
  });
});
