jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

const mockFetchById = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@repositories/prayerRequests.repository', () => ({
  prayerRequestsRepository: {
    fetchById: (...args: unknown[]) => mockFetchById(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import * as prayerIdRouteModule from 'app/api/prayer/[id]/route';

describe('prayer [id] route', () => {
  const params = Promise.resolve({ id: 'p1' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when the prayer does not exist', async () => {
    mockFetchById.mockResolvedValue(null);

    const response = await prayerIdRouteModule.GET({} as Request, { params } as any);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('returns the prayer when found', async () => {
    mockFetchById.mockResolvedValue({ id: 'p1', title: 'Prayer' });

    const response = await prayerIdRouteModule.GET({} as Request, { params } as any);

    expect(mockFetchById).toHaveBeenCalledWith('p1');
    await expect(response.json()).resolves.toEqual({ id: 'p1', title: 'Prayer' });
  });

  it('returns 500 when fetching a prayer fails', async () => {
    mockFetchById.mockRejectedValue(new Error('boom'));

    const response = await prayerIdRouteModule.GET({} as Request, { params } as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch prayer request' });
  });

  it('updates the prayer with normalized fields', async () => {
    mockUpdate.mockResolvedValue({ id: 'p1', title: 'Updated prayer' });

    const response = await prayerIdRouteModule.PUT(
      {
        json: async () => ({
          title: '  Updated prayer  ',
          description: '  Description  ',
          categoryId: 'cat-1',
          tags: ['hope'],
          status: 'active',
          answeredAt: '2026-03-10T00:00:00.000Z',
        }),
      } as Request,
      { params } as any
    );

    expect(mockUpdate).toHaveBeenCalledWith('p1', {
      title: 'Updated prayer',
      description: 'Description',
      categoryId: 'cat-1',
      tags: ['hope'],
      status: 'active',
      answeredAt: '2026-03-10T00:00:00.000Z',
    });
    await expect(response.json()).resolves.toEqual({ id: 'p1', title: 'Updated prayer' });
  });

  it('deletes the prayer', async () => {
    mockDelete.mockResolvedValue(undefined);

    const response = await prayerIdRouteModule.DELETE({} as Request, { params } as any);

    expect(mockDelete).toHaveBeenCalledWith('p1');
    await expect(response.json()).resolves.toEqual({ message: 'Deleted' });
  });

  it('returns 500 when delete fails', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));

    const response = await prayerIdRouteModule.DELETE({} as Request, { params } as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to delete prayer request' });
  });

  it('returns 500 when updates fail', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));

    const response = await prayerIdRouteModule.PUT(
      { json: async () => ({ title: 'Broken' }) } as Request,
      { params } as any
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update prayer request' });
  });
});
