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
  // The route reads the body as TEXT so it can tell "no body" (legal: compose everything)
  // apart from "unreadable body" (a caller bug that used to silently mean the same thing).
  const raw = body === undefined ? '' : JSON.stringify(body);
  return {
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : undefined),
    text: jest.fn().mockResolvedValue(raw),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}

function requestWithRawBody(token: string, raw: string) {
  return {
    headers: new Headers({ authorization: `Bearer ${token}` }),
    text: jest.fn().mockResolvedValue(raw),
    json: jest.fn().mockRejectedValue(new SyntaxError('unexpected token')),
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

  const ownedSermon = {
    id: 'sermon-1',
    userId: 'user-1',
    scratch: [
      { id: 'n1', text: 'First', createdAt: '2026-07-04T00:00:00.000Z' },
      { id: 'n2', text: 'Second', createdAt: '2026-07-04T00:01:00.000Z' },
    ],
    outline: { introduction: [], main: [], conclusion: [] },
  };

  const emptyOutline = { introduction: [], main: [], conclusion: [] };

  function authorizeOwner() {
    (adminAuth.verifyIdToken as jest.Mock).mockResolvedValueOnce({ uid: 'user-1' });
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce(ownedSermon);
  }

  it('rejects an unreadable body instead of quietly composing every scratch note', async () => {
    // The old path collapsed a malformed body into "no subset requested", so a
    // version-skewed client could rearrange the whole sermon believing it asked about two
    // notes. Guessing the caller's intent is how silent damage happens.
    authorizeOwner();

    const response = await POST(requestWithRawBody('valid-token', '{ not json') as never, {
      params: Promise.resolve({ id: 'sermon-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not valid JSON/i);
    expect(composePlanFromScratch).not.toHaveBeenCalled();
  });

  it('still composes everything when no body is sent at all', async () => {
    authorizeOwner();
    (composePlanFromScratch as jest.Mock).mockResolvedValueOnce({
      outline: emptyOutline,
      success: true,
      unplacedScratchNoteIds: [],
    });

    const response = await postWithToken('valid-token');

    expect(response.status).toBe(200);
    expect(composePlanFromScratch).toHaveBeenCalledWith(ownedSermon, ownedSermon.outline, 'user-1');
  });

  it('rejects an empty selection rather than answering 200 with an untouched outline', async () => {
    authorizeOwner();

    const response = await postWithToken('valid-token', { scratchNoteIds: [] });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/must not be empty/i);
    expect(composePlanFromScratch).not.toHaveBeenCalled();
  });

  it('rejects duplicate ids instead of collapsing them silently', async () => {
    authorizeOwner();

    const response = await postWithToken('valid-token', { scratchNoteIds: ['n1', 'n1'] });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/duplicates/i);
    expect(composePlanFromScratch).not.toHaveBeenCalled();
  });

  it('answers 409 and names the notes that disappeared between the two reads', async () => {
    // A note deleted after the client built its request used to vanish in silence, and the
    // preacher got a plan missing a thought he had explicitly asked about.
    authorizeOwner();

    const response = await postWithToken('valid-token', { scratchNoteIds: ['n1', 'gone'] });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.missingScratchNoteIds).toEqual(['gone']);
    expect(composePlanFromScratch).not.toHaveBeenCalled();
  });

  it('passes the unplaced-note report through to the caller', async () => {
    authorizeOwner();
    (composePlanFromScratch as jest.Mock).mockResolvedValueOnce({
      outline: emptyOutline,
      success: true,
      unplacedScratchNoteIds: ['n2'],
    });

    const response = await postWithToken('valid-token', { scratchNoteIds: ['n1', 'n2'] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unplacedScratchNoteIds).toEqual(['n2']);
  });
});
