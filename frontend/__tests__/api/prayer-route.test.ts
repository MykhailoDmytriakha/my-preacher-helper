jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

const mockFetchByUserId = jest.fn();
const mockCreate = jest.fn();

jest.mock('@repositories/prayerRequests.repository', () => ({
  prayerRequestsRepository: {
    fetchByUserId: (...args: unknown[]) => mockFetchByUserId(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

import * as prayerRouteModule from 'app/api/prayer/route';

describe('prayer route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const response = await prayerRouteModule.GET({ url: 'https://example.com/api/prayer' } as Request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing userId' });
  });

  it('returns prayers for a valid user id', async () => {
    mockFetchByUserId.mockResolvedValue([{ id: 'p1', title: 'Prayer' }]);

    const response = await prayerRouteModule.GET({
      url: 'https://example.com/api/prayer?userId=user-1',
    } as Request);

    expect(mockFetchByUserId).toHaveBeenCalledWith('user-1');
    await expect(response.json()).resolves.toEqual([{ id: 'p1', title: 'Prayer' }]);
  });

  it('returns 500 when listing prayers fails', async () => {
    mockFetchByUserId.mockRejectedValue(new Error('boom'));

    const response = await prayerRouteModule.GET({
      url: 'https://example.com/api/prayer?userId=user-1',
    } as Request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch prayer requests' });
  });

  it('validates required fields for creation', async () => {
    const response = await prayerRouteModule.POST({
      json: async () => ({ userId: 'user-1', title: '   ' }),
    } as Request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields: userId, title',
    });
  });

  it('creates a normalized prayer request payload', async () => {
    mockCreate.mockResolvedValue({ id: 'p1', title: 'New prayer' });

    const response = await prayerRouteModule.POST({
      json: async () => ({
        userId: 'user-1',
        title: '  New prayer  ',
        description: '  Context  ',
        categoryId: 'cat-1',
        tags: ['family'],
      }),
    } as Request);

    expect(mockCreate).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'New prayer',
      description: 'Context',
      categoryId: 'cat-1',
      tags: ['family'],
      status: 'active',
      updates: [],
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'p1', title: 'New prayer' });
  });

  it('returns 500 when creation fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));

    const response = await prayerRouteModule.POST({
      json: async () => ({
        userId: 'user-1',
        title: 'New prayer',
        description: 'Context',
      }),
    } as Request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create prayer request' });
  });
});
