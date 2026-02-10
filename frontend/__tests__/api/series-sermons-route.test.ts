import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

import { DELETE, POST, PUT } from 'app/api/series/[id]/sermons/route';

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    fetchSeriesById: jest.fn(),
    addSermonToSeries: jest.fn(),
    reorderSermonsInSeries: jest.fn(),
    removeSermonFromSeries: jest.fn(),
  },
}));

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    updateSermonSeriesInfo: jest.fn(),
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

describe('/api/series/[id]/sermons route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({
      id: 's1',
      items: [
        { id: 'i1', type: 'sermon', refId: 'sermon-1', position: 1 },
        { id: 'i2', type: 'group', refId: 'group-1', position: 2 },
      ],
      sermonIds: ['legacy-sermon'],
    });
    (seriesRepository.addSermonToSeries as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.reorderSermonsInSeries as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.removeSermonFromSeries as jest.Mock).mockResolvedValue(undefined);
    (sermonsRepository.updateSermonSeriesInfo as jest.Mock).mockResolvedValue(undefined);
  });

  describe('POST', () => {
    it('validates sermonId and missing series', async () => {
      const noSermonId = await POST(
        { json: jest.fn().mockResolvedValue({}) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      expect(noSermonId.status).toBe(400);

      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce(null);
      const noSeries = await POST(
        { json: jest.fn().mockResolvedValue({ sermonId: 'sermon-2' }) } as any,
        { params: Promise.resolve({ id: 'missing' }) }
      );
      expect(noSeries.status).toBe(404);
    });

    it('adds sermon and syncs positions', async () => {
      const response = await POST(
        { json: jest.fn().mockResolvedValue({ sermonId: 'sermon-2', position: 2 }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.addSermonToSeries).toHaveBeenCalledWith('s1', 'sermon-2', 2);
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('sermon-1', 's1', 1);
      expect(response.status).toBe(200);
      expect(data.message).toBe('Sermon added to series successfully');
    });

    it('returns 500 on add error', async () => {
      (seriesRepository.addSermonToSeries as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      const response = await POST(
        { json: jest.fn().mockResolvedValue({ sermonId: 'sermon-2' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      expect(response.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('validates payload and missing series', async () => {
      const invalid = await PUT(
        { json: jest.fn().mockResolvedValue({ sermonIds: 'bad' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const empty = await PUT(
        { json: jest.fn().mockResolvedValue({ sermonIds: [] }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      expect(invalid.status).toBe(400);
      expect(empty.status).toBe(400);

      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce(null);
      const noSeries = await PUT(
        { json: jest.fn().mockResolvedValue({ sermonIds: ['sermon-1'] }) } as any,
        { params: Promise.resolve({ id: 'missing' }) }
      );
      expect(noSeries.status).toBe(404);
    });

    it('reorders sermons and syncs positions', async () => {
      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ sermonIds: ['sermon-2', 'sermon-1'] }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.reorderSermonsInSeries).toHaveBeenCalledWith('s1', ['sermon-2', 'sermon-1']);
      expect(response.status).toBe(200);
      expect(data.message).toBe('Sermons reordered successfully');
    });
  });

  describe('DELETE', () => {
    it('validates query params and missing series', async () => {
      const noParam = await DELETE(
        { url: 'https://example.com/api/series/s1/sermons' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      expect(noParam.status).toBe(400);

      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce(null);
      const noSeries = await DELETE(
        { url: 'https://example.com/api/series/missing/sermons?sermonId=sermon-1' } as any,
        { params: Promise.resolve({ id: 'missing' }) }
      );
      expect(noSeries.status).toBe(404);
    });

    it('removes sermon and clears its series info', async () => {
      const response = await DELETE(
        { url: 'https://example.com/api/series/s1/sermons?sermonId=sermon-1' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.removeSermonFromSeries).toHaveBeenCalledWith('s1', 'sermon-1');
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('sermon-1', null, null);
      expect(response.status).toBe(200);
      expect(data.message).toBe('Sermon removed from series successfully');
    });

    it('uses legacy fallback sync when no mixed items are present', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({
        id: 's1',
        items: [],
        sermonIds: ['legacy-sermon-1', 'legacy-sermon-2'],
      });

      await DELETE(
        { url: 'https://example.com/api/series/s1/sermons?sermonId=legacy-sermon-1' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );

      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('legacy-sermon-1', null, null);
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('legacy-sermon-1', 's1', 1);
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('legacy-sermon-2', 's1', 2);
    });
  });
});
