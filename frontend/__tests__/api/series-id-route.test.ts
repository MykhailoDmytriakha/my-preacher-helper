import { adminDb } from '@/config/firebaseAdminConfig';
import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

import { DELETE, GET, PUT } from 'app/api/series/[id]/route';

const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    batch: jest.fn(),
    collection: jest.fn(),
  },
}));

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    updateGroupSeriesInfo: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    fetchSeriesById: jest.fn(),
    updateSeries: jest.fn(),
    deleteSeries: jest.fn(),
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

describe('/api/series/[id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminDb.batch as jest.Mock).mockReturnValue({
      update: mockBatchUpdate,
      commit: mockBatchCommit.mockResolvedValue(undefined),
    });
    (adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn((id: string) => ({ id })),
    });
  });

  describe('GET', () => {
    it('returns 404 when series is missing', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce(null);
      const response = await GET({} as Request, { params: Promise.resolve({ id: 'missing' }) });
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toBe('Series not found');
    });

    it('returns series', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce({ id: 's1' });
      const response = await GET({} as Request, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.id).toBe('s1');
    });
  });

  describe('PUT', () => {
    it('validates status and update payload', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({ id: 's1' });

      const badStatus = await PUT(
        { json: jest.fn().mockResolvedValue({ status: 'bad' }) } as unknown as Request,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const noFields = await PUT(
        { json: jest.fn().mockResolvedValue({ unknown: 'x' }) } as unknown as Request,
        { params: Promise.resolve({ id: 's1' }) }
      );

      expect(badStatus.status).toBe(400);
      expect(noFields.status).toBe(400);
    });

    it('updates series and returns refreshed payload', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock)
        .mockResolvedValueOnce({ id: 's1', title: 'Old' })
        .mockResolvedValueOnce({ id: 's1', title: 'New' });
      (seriesRepository.updateSeries as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ title: 'New', color: '#fff' }) } as unknown as Request,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.updateSeries).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ title: 'New', color: '#fff' })
      );
      expect(response.status).toBe(200);
      expect(data.title).toBe('New');
    });
  });

  describe('DELETE', () => {
    it('returns success when series is already missing', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce(null);
      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'missing' }) });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.message).toBe('Series not found');
    });

    it('clears sermon/group references and deletes series', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        sermonIds: [],
        items: [
          { id: 'i1', type: 'sermon', refId: 'sermon-1', position: 1 },
          { id: 'i2', type: 'group', refId: 'group-1', position: 2 },
          { id: 'i3', type: 'sermon', refId: 'sermon-1', position: 3 },
        ],
      });
      (seriesRepository.deleteSeries as jest.Mock).mockResolvedValueOnce(undefined);
      (groupsRepository.updateGroupSeriesInfo as jest.Mock).mockResolvedValue(undefined);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();

      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockBatchCommit).toHaveBeenCalled();
      expect(groupsRepository.updateGroupSeriesInfo).toHaveBeenCalledWith('group-1', null, null);
      expect(seriesRepository.deleteSeries).toHaveBeenCalledWith('s1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Series deleted successfully');
    });

    it('uses legacy sermonIds fallback when items are empty', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        sermonIds: ['legacy-sermon'],
        items: [],
      });
      (seriesRepository.deleteSeries as jest.Mock).mockResolvedValueOnce(undefined);

      await DELETE({} as Request, { params: Promise.resolve({ id: 's1' }) });
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on delete failure', async () => {
      (seriesRepository.fetchSeriesById as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 's1' }) });
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.message).toBe('Failed to delete series');
    });
  });
});
