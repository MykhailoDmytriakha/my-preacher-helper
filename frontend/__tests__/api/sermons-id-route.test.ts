import { adminDb } from '@/config/firebaseAdminConfig';
import { sermonsRepository } from '@repositories/sermons.repository';
import { seriesRepository } from '@repositories/series.repository';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
    deleteSermonById: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    removeSermonFromAllSeries: jest.fn(),
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

import { GET, PUT, DELETE } from 'app/api/sermons/[id]/route';

describe('Sermons [id] API Route', () => {
  const mockCollection = jest.fn();
  const mockDoc = jest.fn();
  const mockUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUpdate.mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ update: mockUpdate });
    mockCollection.mockReturnValue({ doc: mockDoc });

    const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
    mockedAdminDb.collection.mockImplementation(mockCollection);
  });

  describe('GET', () => {
    it('returns sermon when found', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1' });

      const response = await GET({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(sermonsRepository.fetchSermonById).toHaveBeenCalledWith('sermon-1');
      expect(response.status).toBe(200);
      expect(data).toEqual({ id: 'sermon-1' });
    });

    it('returns 404 when sermon is not found', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockRejectedValueOnce(new Error('Sermon not found'));

      const response = await GET({} as Request, { params: Promise.resolve({ id: 'missing' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Sermon not found');
    });

    it('returns 500 on unexpected error', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockRejectedValueOnce(new Error('Boom'));

      const response = await GET({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch sermon');
    });
  });

  describe('PUT', () => {
    it('returns 400 when no fields provided', async () => {
      const request = { json: jest.fn().mockResolvedValueOnce({}) } as unknown as Request;

      const response = await PUT(request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('No fields provided for update');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updates sermon and returns updated data', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1', title: 'Updated' });

      const request = {
        json: jest.fn().mockResolvedValueOnce({
          title: 'Updated',
          isPreached: false,
          preparation: { notes: 'Test' },
        }),
      } as unknown as Request;

      const response = await PUT(request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(mockCollection).toHaveBeenCalledWith('sermons');
      expect(mockDoc).toHaveBeenCalledWith('sermon-1');
      expect(mockUpdate).toHaveBeenCalledWith({
        title: 'Updated',
        isPreached: false,
        preparation: { notes: 'Test' },
      });
      expect(data).toEqual({ id: 'sermon-1', title: 'Updated' });
    });

    it('returns 500 on update failure', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('Update failed'));
      const request = {
        json: jest.fn().mockResolvedValueOnce({ title: 'Updated' }),
      } as unknown as Request;

      const response = await PUT(request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to update sermon');
    });
  });

  describe('DELETE', () => {
    it('returns 200 when sermon already missing', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce(null);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Проповедь уже отсутствует');
      expect(sermonsRepository.deleteSermonById).not.toHaveBeenCalled();
    });

    it('deletes sermon and cleans up series references', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1' });
      (sermonsRepository.deleteSermonById as jest.Mock).mockResolvedValueOnce(undefined);
      (seriesRepository.removeSermonFromAllSeries as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(sermonsRepository.deleteSermonById).toHaveBeenCalledWith('sermon-1');
      expect(seriesRepository.removeSermonFromAllSeries).toHaveBeenCalledWith('sermon-1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Проповедь успешно удалена');
    });

    it('still succeeds when cleanup fails', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1' });
      (sermonsRepository.deleteSermonById as jest.Mock).mockResolvedValueOnce(undefined);
      (seriesRepository.removeSermonFromAllSeries as jest.Mock).mockRejectedValueOnce(new Error('cleanup failed'));

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Проповедь успешно удалена');
    });

    it('returns 500 on delete error', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockRejectedValueOnce(new Error('Boom'));

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe('Не удалось удалить проповедь');
    });
  });
});
