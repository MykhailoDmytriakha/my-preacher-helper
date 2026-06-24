import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

import { DELETE, PUT } from 'app/api/groups/[id]/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupById: jest.fn(),
    updateGroupSeriesInfo: jest.fn(),
    deleteGroup: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    addGroupToSeries: jest.fn(),
    removeGroupFromSeries: jest.fn(),
    removeGroupFromAllSeries: jest.fn(),
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

describe('/api/groups/[id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT', () => {
    it('returns 404 when updating missing group', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce(null);

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ seriesId: 's1' }) } as unknown as Request,
        { params: Promise.resolve({ id: 'missing' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Group not found');
    });

    it('rejects content-only updates', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce({ id: 'g1' });

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ title: 'Updated' }) } as unknown as Request,
        { params: Promise.resolve({ id: 'g1' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('No series fields provided for update');
      expect(groupsRepository.updateGroupSeriesInfo).not.toHaveBeenCalled();
    });

    it('updates series metadata and syncs series membership when series changes', async () => {
      (groupsRepository.fetchGroupById as jest.Mock)
        .mockResolvedValueOnce({ id: 'g1', seriesId: 'old-series', seriesPosition: 1 })
        .mockResolvedValueOnce({ id: 'g1', seriesId: 'new-series', seriesPosition: 2 });
      (seriesRepository.removeGroupFromSeries as jest.Mock).mockResolvedValueOnce(undefined);
      (seriesRepository.addGroupToSeries as jest.Mock).mockResolvedValueOnce(undefined);
      (groupsRepository.updateGroupSeriesInfo as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ seriesId: 'new-series', seriesPosition: 2 }) } as unknown as Request,
        { params: Promise.resolve({ id: 'g1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.removeGroupFromSeries).toHaveBeenCalledWith('old-series', 'g1');
      expect(seriesRepository.addGroupToSeries).toHaveBeenCalledWith('new-series', 'g1', 2);
      expect(groupsRepository.updateGroupSeriesInfo).toHaveBeenCalledWith('g1', 'new-series', 2);
      expect(response.status).toBe(200);
      expect(data.seriesId).toBe('new-series');
    });
  });

  describe('DELETE', () => {
    it('returns success message when group is already missing', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce(null);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'missing' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Group not found');
    });

    it('deletes group and removes links from series', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce({ id: 'g1' });
      (seriesRepository.removeGroupFromAllSeries as jest.Mock).mockResolvedValueOnce(undefined);
      (groupsRepository.deleteGroup as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'g1' }) });
      const data = await response.json();

      expect(seriesRepository.removeGroupFromAllSeries).toHaveBeenCalledWith('g1');
      expect(groupsRepository.deleteGroup).toHaveBeenCalledWith('g1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Group deleted successfully');
    });

    it('returns 500 on delete failure', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'g1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe('Failed to delete group');
    });
  });
});
