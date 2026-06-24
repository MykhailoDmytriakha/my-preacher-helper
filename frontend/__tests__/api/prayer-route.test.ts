jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

const mockCreate = jest.fn();

jest.mock('@repositories/prayerRequests.repository', () => ({
  prayerRequestsRepository: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

import * as prayerRouteModule from 'app/api/prayer/route';

describe('prayer route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(mockCreate).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        title: 'New prayer',
        description: 'Context',
        categoryId: 'cat-1',
        tags: ['family'],
        status: 'active',
        updates: [],
      },
      undefined // no client-supplied id in this request
    );
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
