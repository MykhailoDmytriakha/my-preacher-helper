import { adminDb } from '@/config/firebaseAdminConfig';
import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

import { DELETE } from 'app/api/series/[id]/route';

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
    fetchGroupById: jest.fn(),
    updateGroupSeriesInfo: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    fetchSeriesById: jest.fn(),
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

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('user-1'),
}));

describe('/api/series/[id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminDb.batch as jest.Mock).mockReturnValue({
      update: mockBatchUpdate,
      commit: mockBatchCommit.mockResolvedValue(undefined),
    });
    (adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn((id: string) => ({
        id,
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ userId: 'user-1' }),
        }),
      })),
    });
    (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValue({ id: 'group-1', userId: 'user-1' });
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
        userId: 'user-1',
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
        userId: 'user-1',
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
