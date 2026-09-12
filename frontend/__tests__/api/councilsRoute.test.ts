import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET as getOne, PUT, DELETE } from '@/api/councils/[id]/route';
import { GET, POST } from '@/api/councils/route';
import { councilsRepository } from '@repositories/councils.repository';

/**
 * THE SECOND ROAD IS STILL A DOOR, and a door is checked: the admin key bypasses the Security
 * Rules, so ownership and the shape of what may be stored are decided here.
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, options = {}) => ({
      status: options.status ?? 200,
      headers: new Map(Object.entries(options.headers ?? {})),
      json: async () => data,
    })),
  },
}));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@repositories/councils.repository', () => ({
  councilsRepository: {
    listForOwner: jest.fn(),
    getForOwner: jest.fn(),
    createForOwner: jest.fn(),
    replaceForOwner: jest.fn(),
    deleteForOwner: jest.fn(),
  },
}));

const mockUid = getRequiredAuthenticatedUid as jest.MockedFunction<typeof getRequiredAuthenticatedUid>;
const repo = councilsRepository as jest.Mocked<typeof councilsRepository>;

const body = () => ({
  title: 'Совет 18 сентября',
  date: '2026-09-18',
  status: 'preparing',
  topics: [{ id: 't1', title: 'Крещение', questions: [], options: [{ id: 'o1', text: 'На Жатву' }] }],
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
});

const request = (method: string, payload?: unknown) =>
  new Request('http://localhost/api/councils', { method, ...(payload ? { body: JSON.stringify(payload) } : {}) });
const params = { params: Promise.resolve({ id: 'c1' }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockUid.mockResolvedValue('owner-1');
});

describe('councils over HTTPS', () => {
  it('refuses an unauthenticated caller everywhere', async () => {
    mockUid.mockResolvedValue(null);
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request('POST', { id: 'c1', council: body() }))).status).toBe(401);
    expect((await PUT(request('PUT', { council: body(), expectedRev: 0 }), params)).status).toBe(401);
    expect((await DELETE(request('DELETE'), params)).status).toBe(401);
    expect(repo.listForOwner).not.toHaveBeenCalled();
  });

  it('lists only the caller\'s councils', async () => {
    repo.listForOwner.mockResolvedValue([{ id: 'c1', userId: 'owner-1', title: 'x', status: 'preparing', topics: [], createdAt: '', updatedAt: '' }]);
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(repo.listForOwner).toHaveBeenCalledWith('owner-1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('creates at the client id and never takes the owner from the payload', async () => {
    repo.createForOwner.mockResolvedValue({ id: 'c1', userId: 'owner-1', ...body(), rev: 0 } as never);
    const response = await POST(request('POST', { id: 'c1', council: { ...body(), userId: 'someone-else' } }));
    // `userId` is not part of the body the schema accepts: the request is refused whole.
    expect(response.status).toBe(400);
    expect(repo.createForOwner).not.toHaveBeenCalled();

    const ok = await POST(request('POST', { id: 'c1', council: body() }));
    expect(ok.status).toBe(201);
    expect(repo.createForOwner).toHaveBeenCalledWith('owner-1', 'c1', body());
  });

  it('refuses a section that is too long instead of trimming it', async () => {
    const council = body();
    council.topics[0].title = 'x'.repeat(301);
    const response = await POST(request('POST', { id: 'c1', council }));
    expect(response.status).toBe(400);
  });

  it('answers 409 with the current council when the base was superseded', async () => {
    const current = { id: 'c1', userId: 'owner-1', ...body(), rev: 3 };
    repo.replaceForOwner.mockResolvedValue({ conflict: true, current } as never);
    const response = await PUT(request('PUT', { council: body(), expectedRev: 2 }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(current);
    expect(repo.replaceForOwner).toHaveBeenCalledWith('owner-1', 'c1', body(), 2);
  });

  it('maps a missing or foreign council to 404 on read, replace and delete', async () => {
    repo.getForOwner.mockResolvedValue(null);
    expect((await getOne(request('GET'), params)).status).toBe(404);
    const notFound = Object.assign(new Error('Council not found'), { code: 'not-found' });
    repo.replaceForOwner.mockRejectedValue(notFound);
    expect((await PUT(request('PUT', { council: body(), expectedRev: null }), params)).status).toBe(404);
    repo.deleteForOwner.mockRejectedValue(notFound);
    expect((await DELETE(request('DELETE'), params)).status).toBe(404);
  });
});
