import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

import { DELETE, POST, PUT } from 'app/api/series/[id]/items/route';

jest.mock('@repositories/groups.repository', () => ({
  groupsRepository: {
    updateGroupSeriesInfo: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    fetchSeriesById: jest.fn(),
    addSermonToSeries: jest.fn(),
    addGroupToSeries: jest.fn(),
    reorderSeriesItems: jest.fn(),
    removeSermonFromSeries: jest.fn(),
    removeGroupFromSeries: jest.fn(),
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

describe('/api/series/[id]/items route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({
      id: 's1',
      items: [
        { id: 'item-sermon', type: 'sermon', refId: 'sermon-1', position: 1 },
        { id: 'item-group', type: 'group', refId: 'group-1', position: 2 },
      ],
    });
    (seriesRepository.addSermonToSeries as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.addGroupToSeries as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.reorderSeriesItems as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.removeSermonFromSeries as jest.Mock).mockResolvedValue(undefined);
    (seriesRepository.removeGroupFromSeries as jest.Mock).mockResolvedValue(undefined);
    (sermonsRepository.updateSermonSeriesInfo as jest.Mock).mockResolvedValue(undefined);
    (groupsRepository.updateGroupSeriesInfo as jest.Mock).mockResolvedValue(undefined);
  });

  describe('POST', () => {
    it('validates payload', async () => {
      const invalidType = await POST(
        { json: jest.fn().mockResolvedValue({ type: 'bad', refId: 'x' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const missingRef = await POST(
        { json: jest.fn().mockResolvedValue({ type: 'sermon', refId: '' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const invalidTypeData = await invalidType.json();
      const missingRefData = await missingRef.json();

      expect(invalidType.status).toBe(400);
      expect(missingRef.status).toBe(400);
      expect(invalidTypeData.error).toBe('Invalid item type');
      expect(missingRefData.error).toBe('refId is required');
    });

    it('adds sermon and group and syncs positions', async () => {
      const addSermonResponse = await POST(
        { json: jest.fn().mockResolvedValue({ type: 'sermon', refId: 'sermon-2', position: 1 }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const addGroupResponse = await POST(
        { json: jest.fn().mockResolvedValue({ type: 'group', refId: 'group-2' }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );

      expect(seriesRepository.addSermonToSeries).toHaveBeenCalledWith('s1', 'sermon-2', 1);
      expect(seriesRepository.addGroupToSeries).toHaveBeenCalledWith('s1', 'group-2', undefined);
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('sermon-1', 's1', 1);
      expect(groupsRepository.updateGroupSeriesInfo).toHaveBeenCalledWith('group-1', 's1', 2);
      expect(addSermonResponse.status).toBe(200);
      expect(addGroupResponse.status).toBe(200);
    });
  });

  describe('PUT', () => {
    it('validates reorder payload', async () => {
      const invalid = await PUT(
        { json: jest.fn().mockResolvedValue({ itemIds: [1, 2] }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const empty = await PUT(
        { json: jest.fn().mockResolvedValue({ itemIds: [] }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const invalidData = await invalid.json();
      const emptyData = await empty.json();

      expect(invalid.status).toBe(400);
      expect(empty.status).toBe(400);
      expect(invalidData.error).toContain('itemIds');
      expect(emptyData.error).toContain('cannot be empty');
    });

    it('reorders mixed items and syncs positions', async () => {
      const response = await PUT(
        { json: jest.fn().mockResolvedValue({ itemIds: ['item-group', 'item-sermon'] }) } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const data = await response.json();

      expect(seriesRepository.reorderSeriesItems).toHaveBeenCalledWith('s1', ['item-group', 'item-sermon']);
      expect(response.status).toBe(200);
      expect(data.message).toBe('Series items reordered successfully');
    });
  });

  describe('DELETE', () => {
    it('validates delete query params', async () => {
      const badType = await DELETE(
        { url: 'https://example.com/api/series/s1/items?type=bad&refId=1' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const missingRef = await DELETE(
        { url: 'https://example.com/api/series/s1/items?type=group' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const badTypeData = await badType.json();
      const missingRefData = await missingRef.json();

      expect(badType.status).toBe(400);
      expect(missingRef.status).toBe(400);
      expect(badTypeData.error).toBe('Invalid item type');
      expect(missingRefData.error).toContain('refId');
    });

    it('removes sermon and group items', async () => {
      const sermonResponse = await DELETE(
        { url: 'https://example.com/api/series/s1/items?type=sermon&refId=sermon-1' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );
      const groupResponse = await DELETE(
        { url: 'https://example.com/api/series/s1/items?type=group&refId=group-1' } as any,
        { params: Promise.resolve({ id: 's1' }) }
      );

      expect(seriesRepository.removeSermonFromSeries).toHaveBeenCalledWith('s1', 'sermon-1');
      expect(sermonsRepository.updateSermonSeriesInfo).toHaveBeenCalledWith('sermon-1', null, null);
      expect(seriesRepository.removeGroupFromSeries).toHaveBeenCalledWith('s1', 'group-1');
      expect(groupsRepository.updateGroupSeriesInfo).toHaveBeenCalledWith('group-1', null, null);
      expect(sermonResponse.status).toBe(200);
      expect(groupResponse.status).toBe(200);
    });
  });
});
