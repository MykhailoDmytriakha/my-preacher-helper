jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

const mockAddUpdate = jest.fn();

jest.mock('@repositories/prayerRequests.repository', () => ({
  prayerRequestsRepository: {
    addUpdate: (...args: unknown[]) => mockAddUpdate(...args),
  },
}));

import * as prayerUpdatesRouteModule from 'app/api/prayer/[id]/updates/route';

describe('prayer [id]/updates route', () => {
  const params = Promise.resolve({ id: 'p1' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a non-empty update body', async () => {
    const response = await prayerUpdatesRouteModule.POST(
      { json: async () => ({ text: '   ' }) } as Request,
      { params } as any
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing text' });
  });

  it('adds a trimmed update and returns 201', async () => {
    mockAddUpdate.mockResolvedValue({ id: 'p1', updates: [{ id: 'u1', text: 'Fresh note' }] });

    const response = await prayerUpdatesRouteModule.POST(
      { json: async () => ({ text: '  Fresh note  ' }) } as Request,
      { params } as any
    );

    expect(mockAddUpdate).toHaveBeenCalledWith('p1', 'Fresh note');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'p1',
      updates: [{ id: 'u1', text: 'Fresh note' }],
    });
  });

  it('returns 500 when update creation fails', async () => {
    mockAddUpdate.mockRejectedValue(new Error('boom'));

    const response = await prayerUpdatesRouteModule.POST(
      { json: async () => ({ text: 'Fresh note' }) } as Request,
      { params } as any
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to add update' });
  });
});
