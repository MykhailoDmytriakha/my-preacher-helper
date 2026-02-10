import { sermonsRepository } from '@repositories/sermons.repository';

import { GET, POST } from 'app/api/sermons/[id]/preach-dates/route';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    addPreachDate: jest.fn(),
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

describe('/api/sermons/[id]/preach-dates route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await POST(
        { json: jest.fn().mockResolvedValue({ date: '2026-02-15' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: date and church name');
      expect(sermonsRepository.addPreachDate).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid date format', async () => {
      const response = await POST(
        {
          json: jest.fn().mockResolvedValue({
            date: 'not-a-date',
            church: { id: 'c1', name: 'Church' },
          }),
        } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid date format');
      expect(sermonsRepository.addPreachDate).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid status value', async () => {
      const response = await POST(
        {
          json: jest.fn().mockResolvedValue({
            date: '2026-02-15',
            status: 'invalid-status',
            church: { id: 'c1', name: 'Church' },
          }),
        } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid status value');
      expect(sermonsRepository.addPreachDate).not.toHaveBeenCalled();
    });

    it('normalizes timestamp to date-only and creates preach date', async () => {
      (sermonsRepository.addPreachDate as jest.Mock).mockResolvedValueOnce({
        id: 'pd1',
        date: '2026-02-15',
      });

      const response = await POST(
        {
          json: jest.fn().mockResolvedValue({
            date: '2026-02-15T16:00:00.000Z',
            status: 'planned',
            church: { id: 'c1', name: 'Church' },
          }),
        } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(sermonsRepository.addPreachDate).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          date: '2026-02-15',
          status: 'planned',
        })
      );
      expect(response.status).toBe(200);
      expect(data.preachDate.id).toBe('pd1');
    });

    it('returns 404 when sermon is not found', async () => {
      (sermonsRepository.addPreachDate as jest.Mock).mockRejectedValueOnce(new Error('Sermon not found'));

      const response = await POST(
        {
          json: jest.fn().mockResolvedValue({
            date: '2026-02-15',
            church: { id: 'c1', name: 'Church' },
          }),
        } as any,
        { params: Promise.resolve({ id: 'missing-sermon' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Sermon not found');
    });

    it('returns 500 on unexpected error', async () => {
      (sermonsRepository.addPreachDate as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await POST(
        {
          json: jest.fn().mockResolvedValue({
            date: '2026-02-15',
            church: { id: 'c1', name: 'Church' },
          }),
        } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to add preach date');
    });
  });

  describe('GET', () => {
    it('returns preach dates list', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        preachDates: [{ id: 'pd1', date: '2026-02-15' }],
      });

      const response = await GET({} as any, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preachDates).toHaveLength(1);
    });

    it('returns empty list when sermon has no preach dates', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 's1' });

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
