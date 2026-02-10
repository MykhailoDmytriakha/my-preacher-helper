import { groupsRepository } from '@repositories/groups.repository';

import { GET, POST } from 'app/api/groups/[id]/meeting-dates/route';
import {
  DELETE as DELETE_BY_ID,
  PUT as PUT_BY_ID,
} from 'app/api/groups/[id]/meeting-dates/[dateId]/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupById: jest.fn(),
    addMeetingDate: jest.fn(),
    updateMeetingDate: jest.fn(),
    deleteMeetingDate: jest.fn(),
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

describe('/api/groups/[id]/meeting-dates routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET list', () => {
    it('returns 404 for unknown group', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce(null);
      const response = await GET({} as any, { params: Promise.resolve({ id: 'g1' }) });
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toBe('Group not found');
    });

    it('returns meeting dates array', async () => {
      (groupsRepository.fetchGroupById as jest.Mock).mockResolvedValueOnce({
        id: 'g1',
        meetingDates: [{ id: 'd1', date: '2026-02-11', createdAt: 'x' }],
      });

      const response = await GET({} as any, { params: Promise.resolve({ id: 'g1' }) });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.meetingDates).toHaveLength(1);
    });
  });

  describe('POST create', () => {
    it('returns 400 when date is missing', async () => {
      const response = await POST(
        { json: jest.fn().mockResolvedValue({}) } as any,
        { params: Promise.resolve({ id: 'g1' }) }
      );
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('date is required');
    });

    it('creates meeting date', async () => {
      (groupsRepository.addMeetingDate as jest.Mock).mockResolvedValueOnce({
        id: 'd1',
        date: '2026-02-11',
        createdAt: 'x',
      });

      const response = await POST(
        { json: jest.fn().mockResolvedValue({ date: '2026-02-11', location: 'Hall' }) } as any,
        { params: Promise.resolve({ id: 'g1' }) }
      );
      const data = await response.json();

      expect(groupsRepository.addMeetingDate).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ date: '2026-02-11', location: 'Hall' })
      );
      expect(response.status).toBe(201);
      expect(data.meetingDate.id).toBe('d1');
    });
  });

  describe('PUT/DELETE by date id', () => {
    it('updates meeting date', async () => {
      (groupsRepository.updateMeetingDate as jest.Mock).mockResolvedValueOnce({
        id: 'd1',
        date: '2026-02-12',
        createdAt: 'x',
      });

      const response = await PUT_BY_ID(
        { json: jest.fn().mockResolvedValue({ date: '2026-02-12' }) } as any,
        { params: Promise.resolve({ id: 'g1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(groupsRepository.updateMeetingDate).toHaveBeenCalledWith(
        'g1',
        'd1',
        expect.objectContaining({ date: '2026-02-12' })
      );
      expect(response.status).toBe(200);
      expect(data.meetingDate.id).toBe('d1');
    });

    it('deletes meeting date', async () => {
      (groupsRepository.deleteMeetingDate as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await DELETE_BY_ID(
        {} as any,
        { params: Promise.resolve({ id: 'g1', dateId: 'd1' }) }
      );
      const data = await response.json();

      expect(groupsRepository.deleteMeetingDate).toHaveBeenCalledWith('g1', 'd1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Meeting date deleted successfully');
    });

    it('returns 500 on update/delete errors', async () => {
      (groupsRepository.updateMeetingDate as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      (groupsRepository.deleteMeetingDate as jest.Mock).mockRejectedValueOnce(new Error('boom'));

      const updateResponse = await PUT_BY_ID(
        { json: jest.fn().mockResolvedValue({ date: 'x' }) } as any,
        { params: Promise.resolve({ id: 'g1', dateId: 'd1' }) }
      );
      const deleteResponse = await DELETE_BY_ID(
        {} as any,
        { params: Promise.resolve({ id: 'g1', dateId: 'd1' }) }
      );
      const updateData = await updateResponse.json();
      const deleteData = await deleteResponse.json();

      expect(updateResponse.status).toBe(500);
      expect(deleteResponse.status).toBe(500);
      expect(updateData.error).toBe('Failed to update meeting date');
      expect(deleteData.error).toBe('Failed to delete meeting date');
    });
  });
});
