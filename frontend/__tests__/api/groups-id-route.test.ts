import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

import { DELETE, GET, PUT } from 'app/api/groups/[id]/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupById: jest.fn(),
    updateGroup: jest.fn(),
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

describe('/api/groups/[id] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 404 when group does not exist', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce(null);

      const response = await GET({} as Request, { params: Promise.resolve({ id: 'missing' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Group not found');
    });

    it('returns group details', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce({ id: 'g1' });

      const response = await GET({} as Request, { params: Promise.resolve({ id: 'g1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ id: 'g1' });
    });
  });

  describe('PUT', () => {
    it('returns 404 when updating missing group', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce(null);

      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ title: 'x' }) } as unknown as Request,
        { params: Promise.resolve({ id: 'missing' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Group not found');
    });

    it('updates group and trims payload values', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce({ id: 'g1' });
      (groupsRepository.updateGroup as jest.Mock).mockResolvedValueOnce({ id: 'g1', title: 'Updated' });

      const response = await PUT(
        {
          json: jest.fn().mockResolvedValue({
            title: '  Updated  ',
            description: '  ',
            status: 'active',
            flow: [{ id: 'f1', templateId: 't1', order: 1 }],
          }),
        } as unknown as Request,
        { params: Promise.resolve({ id: 'g1' }) }
      );
      const data = await response.json();

      expect(groupsRepository.updateGroup).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({
          title: 'Updated',
          description: undefined,
          status: 'active',
        })
      );
      expect(response.status).toBe(200);
      expect(data.id).toBe('g1');
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
