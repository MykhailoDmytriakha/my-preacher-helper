import { sermonsRepository } from '@repositories/sermons.repository';

import {
  DELETE,
  PUT,
} from 'app/api/sermons/[id]/preach-dates/[dateId]/route';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    updatePreachDate: jest.fn(),
    deletePreachDate: jest.fn(),
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

describe('/api/sermons/[id]/preach-dates/[dateId] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT', () => {
    it('rejects invalid status', async () => {
      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ status: 'bad' }) } as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid status value');
      expect(sermonsRepository.updatePreachDate).not.toHaveBeenCalled();
    });

    it('rejects invalid date format', async () => {
      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ date: 'bad-date' }) } as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid date format');
      expect(sermonsRepository.updatePreachDate).not.toHaveBeenCalled();
    });

    it('sanitizes payload and normalizes date before update', async () => {
      (sermonsRepository.updatePreachDate as jest.Mock).mockResolvedValueOnce({
        id: 'd1',
        date: '2026-02-17',
      });

      const response = await PUT(
        {
          json: jest.fn().mockResolvedValue({
            id: 'hack',
            createdAt: 'hack',
            date: '2026-02-17T09:30:00.000Z',
            status: 'preached',
            audience: 'Church',
          }),
        } as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(sermonsRepository.updatePreachDate).toHaveBeenCalledWith('s1', 'd1', {
        date: '2026-02-17',
        status: 'preached',
        audience: 'Church',
      });
      expect(response.status).toBe(200);
      expect(data.preachDate.id).toBe('d1');
    });

    it('returns 404 for missing sermon or date', async () => {
      (sermonsRepository.updatePreachDate as jest.Mock).mockRejectedValueOnce(new Error('Preach date not found'));

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ status: 'planned' }) } as any,
        { params: Promise.resolve({ id: 's1', dateId: 'missing' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Preach date not found');
    });

    it('returns 500 on unexpected update error', async () => {
      (sermonsRepository.updatePreachDate as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ status: 'planned' }) } as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to update preach date');
    });
  });

  describe('DELETE', () => {
    it('deletes preach date successfully', async () => {
      (sermonsRepository.deletePreachDate as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await DELETE(
        {} as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(sermonsRepository.deletePreachDate).toHaveBeenCalledWith('s1', 'd1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Preach date deleted');
    });

    it('returns 404 when sermon is missing', async () => {
      (sermonsRepository.deletePreachDate as jest.Mock).mockRejectedValueOnce(new Error('Sermon not found'));

      const response = await DELETE(
        {} as any,
        { params: Promise.resolve({ id: 'missing', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Sermon not found');
    });

    it('returns 500 on unexpected delete error', async () => {
      (sermonsRepository.deletePreachDate as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await DELETE(
        {} as any,
        { params: Promise.resolve({ id: 's1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete preach date');
    });
  });
});
