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
    expect((await PUT(request('PUT', { council: body(), expectedRev: 0 }))).status).toBe(401);
    expect((await DELETE(request('DELETE'))).status).toBe(401);
    expect(repo.listForOwner).not.toHaveBeenCalled();
  });

  it('lists only the caller\'s councils', async () => {
    repo.listForOwner.mockResolvedValue([{ id: 'c1', userId: 'owner-1', title: 'x', status: 'preparing', topics: [], createdAt: '', updatedAt: '' }]);
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(repo.listForOwner).toHaveBeenCalledWith('owner-1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('maps a missing or foreign council to 404 on read', async () => {
    repo.getForOwner.mockResolvedValue(null);
    expect((await getOne(request('GET'), params)).status).toBe(404);
  });
});

// Councils are written only through the data engine. A shipped bundle still calls these routes, and
// its council client reads 409 as "conflict, the body is the current council" — so every write it
// sends is refused with 426, whatever the body says.
it('refuses a shipped bundle\'s create, replace and delete with 426, never 409', async () => {
  for (const response of [await POST(request('POST', { id: 'c1', council: body() })), await PUT(request('PUT', { council: body(), expectedRev: 2 })), await DELETE(request('DELETE'))]) {
    expect(response.status).toBe(426); expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
  }
});
