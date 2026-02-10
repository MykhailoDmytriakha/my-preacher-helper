import { groupsRepository } from '@repositories/groups.repository';

import { GET } from 'app/api/calendar/groups/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    fetchGroupsWithMeetingDates: jest.fn(),
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

describe('/api/calendar/groups route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const response = await GET({ url: 'https://example.com/api/calendar/groups' } as Request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing userId parameter');
  });

  it('returns groups filtered by optional date params', async () => {
    (groupsRepository.fetchGroupsWithMeetingDates as jest.Mock).mockResolvedValueOnce([{ id: 'g1' }]);

    const response = await GET({
      url: 'https://example.com/api/calendar/groups?userId=user-1&startDate=2026-02-01&endDate=2026-02-29',
    } as Request);
    const data = await response.json();

    expect(groupsRepository.fetchGroupsWithMeetingDates).toHaveBeenCalledWith(
      'user-1',
      '2026-02-01',
      '2026-02-29'
    );
    expect(response.status).toBe(200);
    expect(data.groups).toEqual([{ id: 'g1' }]);
  });

  it('returns 500 when repository fails', async () => {
    (groupsRepository.fetchGroupsWithMeetingDates as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const response = await GET({
      url: 'https://example.com/api/calendar/groups?userId=user-1',
    } as Request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch groups for calendar');
  });
});
