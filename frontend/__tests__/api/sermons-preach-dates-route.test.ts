import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sermonsRepository } from '@repositories/sermons.repository';

import { GET, POST } from 'app/api/sermons/[id]/preach-dates/route';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
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

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('user-1'),
}));

describe('/api/sermons/[id]/preach-dates route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({ id: 's1', userId: 'user-1' });
  });

  describe('POST (legacy write route, closed)', () => {
    const post = () => POST(new Request('http://localhost/api/sermons/s1/preach-dates', { method: 'POST' }));

    it('answers 401 without a verified token and reads nothing', async () => {
      (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);
      expect((await post()).status).toBe(401);
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });

    it('answers 426 data-engine-required with a token and writes nothing', async () => {
      const response = await post();
      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('returns preach dates list', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        userId: 'user-1',
        preachDates: [{ id: 'pd1', date: '2026-02-15' }],
      });

      const response = await GET({} as any, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preachDates).toHaveLength(1);
    });

    it('returns empty list when sermon has no preach dates', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 's1', userId: 'user-1' });

      const response = await GET({} as any, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preachDates).toEqual([]);
    });

    it('returns 404 when sermon is not found', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockRejectedValueOnce(new Error('Sermon not found'));

      const response = await GET({} as any, { params: Promise.resolve({ id: 'missing-sermon' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Sermon not found');
    });

    it('returns 500 on unexpected error', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await GET({} as any, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch preach dates');
    });
  });
});
