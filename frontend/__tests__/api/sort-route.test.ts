import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sortItemsWithAI } from '@/api/clients/openAI.client';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { POST } from '@/api/sort/route';
import { UsageCapReachedError } from '@/services/usageLimits';

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init: { status?: number } = {}) => ({
      status: init.status ?? 200,
      json: async () => data,
    })),
  },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

jest.mock('@/api/repositories/sermons.repository', () => ({
  sermonsRepository: { fetchSermonById: jest.fn() },
}));

jest.mock('@/api/clients/openAI.client', () => ({
  sortItemsWithAI: jest.fn(),
}));

const mockAuth = getRequiredAuthenticatedUid as jest.Mock;
const mockFetchSermon = sermonsRepository.fetchSermonById as jest.Mock;
const mockSort = sortItemsWithAI as jest.Mock;

const SERMON = { id: 'sermon-1', userId: 'user-1', title: 'Sermon', verse: 'John 3:16' };
const OUTLINE_POINTS = [{ id: 'outline-1', text: 'Point' }];

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `item-${i}-abcdef`, content: `Thought ${i}` }));

const validBody = (overrides: Record<string, unknown> = {}) => ({
  columnId: 'introduction',
  items: makeItems(3),
  sermonId: 'sermon-1',
  outlinePoints: OUTLINE_POINTS,
  ...overrides,
});

const makeRequest = (body: unknown) => ({ json: jest.fn().mockResolvedValue(body) }) as unknown as Request;
const makeMalformedRequest = () =>
  ({ json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')) }) as unknown as Request;

const call = async (body: unknown) => {
  const response = await POST(makeRequest(body));
  return { status: response.status, data: await response.json() };
};

describe('POST /api/sort', () => {
  let consoleSpies: jest.SpyInstance[];

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    mockAuth.mockResolvedValue('user-1');
    mockFetchSermon.mockResolvedValue(SERMON);
    mockSort.mockImplementation(async (_column, items) => [...items].reverse());
  });

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  it('sorts the items with AI and returns them with the caller uid passed for metering', async () => {
    const body = validBody();

    const { status, data } = await call(body);

    expect(status).toBe(200);
    expect(data).toEqual({ sortedItems: [...body.items].reverse() });
    expect(mockFetchSermon).toHaveBeenCalledWith('sermon-1');
    expect(mockSort).toHaveBeenCalledWith('introduction', body.items, SERMON, OUTLINE_POINTS, 'user-1');
  });

  it('sorts only the first 25 items when more are sent', async () => {
    const items = makeItems(30);

    const { status, data } = await call(validBody({ items }));

    expect(status).toBe(200);
    expect(mockSort.mock.calls[0][1]).toEqual(items.slice(0, 25));
    expect(data.sortedItems).toHaveLength(25);
  });

  it.each([
    ['columnId is missing', { columnId: undefined }],
    ['columnId is empty', { columnId: '' }],
    ['items is missing', { items: undefined }],
    ['items is not an array', { items: 'not-an-array' }],
    ['sermonId is missing', { sermonId: undefined }],
  ])('returns 400 when %s', async (_name, overrides) => {
    const { status, data } = await call(validBody(overrides));

    expect(status).toBe(400);
    expect(data).toEqual({ error: 'Missing required parameters' });
    expect(mockFetchSermon).not.toHaveBeenCalled();
    expect(mockSort).not.toHaveBeenCalled();
  });

  it('returns 500 when the request body is malformed JSON', async () => {
    const response = await POST(makeMalformedRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to sort items' });
    expect(mockSort).not.toHaveBeenCalled();
  });

  it('returns 404 when the sermon does not exist', async () => {
    mockFetchSermon.mockResolvedValue(null);

    const { status, data } = await call(validBody({ sermonId: 'missing' }));

    expect(status).toBe(404);
    expect(data).toEqual({ error: 'Sermon not found' });
    expect(mockSort).not.toHaveBeenCalled();
  });

  it('returns the items unchanged without calling AI when the items list is empty', async () => {
    const { status, data } = await call(validBody({ items: [] }));

    expect(status).toBe(200);
    expect(data).toEqual({ sortedItems: [] });
    expect(mockSort).not.toHaveBeenCalled();
  });

  it('returns 500 when the AI client fails', async () => {
    mockSort.mockRejectedValue(new Error('OpenAI down'));

    const { status, data } = await call(validBody());

    expect(status).toBe(500);
    expect(data).toEqual({ error: 'Failed to sort items' });
  });

  it('returns 429 with the usage cap payload when the AI usage cap is reached', async () => {
    mockSort.mockRejectedValue(new UsageCapReachedError('ai', 10, 10, 12, '2026-10-01T00:00:00.000Z'));

    const { status, data } = await call(validBody());

    expect(status).toBe(429);
    expect(data).toEqual({
      code: 'USAGE_CAP_REACHED',
      resource: 'ai',
      used: 10,
      baseLimit: 10,
      hardCap: 12,
      resetsAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
