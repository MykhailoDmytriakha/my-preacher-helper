import { groupsRepository } from '@repositories/groups.repository';

import { GET, POST } from 'app/api/groups/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupsByUserId: jest.fn(),
    createGroup: jest.fn(),
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

describe('/api/groups route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 400 when userId is missing', async () => {
      const response = await GET({ url: 'https://example.com/api/groups' } as Request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing userId parameter');
      expect(groupsRepository.fetchGroupsByUserId).not.toHaveBeenCalled();
    });

    it('returns groups payload', async () => {
      (groupsRepository.fetchGroupsByUserId as jest.Mock).mockResolvedValueOnce([{ id: 'g1' }]);

      const response = await GET({ url: 'https://example.com/api/groups?userId=user-1' } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(groupsRepository.fetchGroupsByUserId).toHaveBeenCalledWith('user-1');
      expect(data).toEqual([{ id: 'g1' }]);
    });

    it('returns 500 on repository error', async () => {
      (groupsRepository.fetchGroupsByUserId as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await GET({ url: 'https://example.com/api/groups?userId=user-1' } as Request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch groups');
    });
  });

  describe('POST', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await POST({
        json: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      } as unknown as Request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required fields');
      expect(groupsRepository.createGroup).not.toHaveBeenCalled();
    });

    it('creates group and trims fields', async () => {
      (groupsRepository.createGroup as jest.Mock).mockResolvedValueOnce({ id: 'g1', title: 'My Group' });

      const response = await POST({
        json: jest.fn().mockResolvedValue({
          userId: 'user-1',
          title: '  My Group  ',
          description: '  Desc  ',
          status: 'active',
          templates: [],
          flow: [],
          meetingDates: [],
        }),
      } as unknown as Request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(groupsRepository.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          title: 'My Group',
          description: 'Desc',
          status: 'active',
        })
      );
      expect(data.group.id).toBe('g1');
    });

    it('returns 500 on create failure', async () => {
      (groupsRepository.createGroup as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const response = await POST({
        json: jest.fn().mockResolvedValue({ userId: 'user-1', title: 'Group' }),
      } as unknown as Request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create group');
    });
  });
});
