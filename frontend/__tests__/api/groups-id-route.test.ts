import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

import { DELETE } from 'app/api/groups/[id]/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupById: jest.fn(),
    deleteGroup: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
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

// The PUT /api/groups/[id] handler (server series-binding cascade) was removed in
// the playlist migration — a group's series membership now lives in series.items
// and is written by the client sweep. Only DELETE (delete-cleanup) remains.
describe('/api/groups/[id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
