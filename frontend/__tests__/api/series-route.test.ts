import { seriesRepository } from '@repositories/series.repository';

import { GET, POST } from 'app/api/series/route';

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    fetchSeriesByUserId: jest.fn(),
    createSeries: jest.fn(),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

describe('/api/series route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 401 without userId', async () => {
      const response = await GET({ url: 'https://example.com/api/series' } as Request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('User not authenticated');
    });

    it('returns series list', async () => {
      (seriesRepository.fetchSeriesByUserId as jest.Mock).mockResolvedValueOnce([{ id: 's1' }]);

      const response = await GET({ url: 'https://example.com/api/series?userId=user-1' } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(seriesRepository.fetchSeriesByUserId).toHaveBeenCalledWith('user-1');
      expect(data).toEqual([{ id: 's1' }]);
    });

    it('returns 500 on repository failure', async () => {
      (seriesRepository.fetchSeriesByUserId as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await GET({ url: 'https://example.com/api/series?userId=user-1' } as Request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch series');
    });
  });

  describe('POST', () => {
    it('validates required fields and status', async () => {
      const missing = await POST({
        json: jest.fn().mockResolvedValue({ userId: 'u1', title: 't' }),
      } as unknown as Request);
      const invalidStatus = await POST({
        json: jest.fn().mockResolvedValue({
          userId: 'u1',
          title: 't',
          theme: 'th',
          bookOrTopic: 'romans',
          status: 'bad',
        }),
      } as unknown as Request);

      expect(missing.status).toBe(400);
      expect(invalidStatus.status).toBe(400);
    });

    it('creates series and returns payload', async () => {
      (seriesRepository.createSeries as jest.Mock).mockResolvedValueOnce({ id: 's1', title: 'Title' });

      const response = await POST({
        json: jest.fn().mockResolvedValue({
          userId: 'u1',
          title: 'Title',
          theme: 'Theme',
          bookOrTopic: 'John',
          status: 'active',
          sermonIds: ['sermon-1'],
        }),
      } as unknown as Request);
      const data = await response.json();

      expect(seriesRepository.createSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          title: 'Title',
          status: 'active',
          sermonIds: ['sermon-1'],
        })
      );
      expect(response.status).toBe(200);
      expect(data.message).toBe('Series created successfully');
      expect(data.series.id).toBe('s1');
    });

    it('returns 500 when create fails', async () => {
      (seriesRepository.createSeries as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await POST({
        json: jest.fn().mockResolvedValue({
          userId: 'u1',
          title: 'Title',
          theme: 'Theme',
          bookOrTopic: 'John',
        }),
      } as unknown as Request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create series');
    });
  });
});
