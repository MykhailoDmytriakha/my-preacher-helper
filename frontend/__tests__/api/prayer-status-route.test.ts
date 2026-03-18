jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

const mockSetStatus = jest.fn();

jest.mock('@repositories/prayerRequests.repository', () => ({
  prayerRequestsRepository: {
    setStatus: (...args: unknown[]) => mockSetStatus(...args),
  },
}));

import * as prayerStatusRouteModule from 'app/api/prayer/[id]/status/route';

describe('prayer [id]/status route', () => {
  const params = Promise.resolve({ id: 'p1' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid statuses', async () => {
    const response = await prayerStatusRouteModule.PUT(
      { json: async () => ({ status: 'broken' }) } as Request,
      { params } as any
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid status' });
  });

  it('updates status through the repository', async () => {
    mockSetStatus.mockResolvedValue({ id: 'p1', status: 'answered' });

    const response = await prayerStatusRouteModule.PUT(
      { json: async () => ({ status: 'answered', answerText: 'Great news' }) } as Request,
      { params } as any
    );

    expect(mockSetStatus).toHaveBeenCalledWith('p1', 'answered', 'Great news');
    await expect(response.json()).resolves.toEqual({ id: 'p1', status: 'answered' });
  });

  it('returns 500 when status updates fail', async () => {
    mockSetStatus.mockRejectedValue(new Error('boom'));

    const response = await prayerStatusRouteModule.PUT(
      { json: async () => ({ status: 'active' }) } as Request,
      { params } as any
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update status' });
  });
});
