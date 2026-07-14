import { sermonsRepository } from '@repositories/sermons.repository';
import { seriesRepository } from '@repositories/series.repository';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
  },
}));

jest.mock('@repositories/series.repository', () => ({
  seriesRepository: {
    deleteSermonAndDetachFromAllSeries: jest.fn(),
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

import { DELETE } from 'app/api/sermons/[id]/route';

describe('Sermons [id] API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DELETE', () => {
    it('returns 200 when sermon already missing', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce(null);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Проповедь уже отсутствует');
      expect(seriesRepository.deleteSermonAndDetachFromAllSeries).not.toHaveBeenCalled();
    });

    it('atomically deletes the sermon and detaches it from series in one call', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1', userId: 'user-1' });
      (seriesRepository.deleteSermonAndDetachFromAllSeries as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(seriesRepository.deleteSermonAndDetachFromAllSeries).toHaveBeenCalledWith('sermon-1', 'user-1');
      expect(response.status).toBe(200);
      expect(data.message).toBe('Проповедь успешно удалена');
    });

    it('returns 500 (nothing committed) when the atomic delete fails — no silent success', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({ id: 'sermon-1', userId: 'user-1' });
      (seriesRepository.deleteSermonAndDetachFromAllSeries as jest.Mock).mockRejectedValueOnce(new Error('batch failed'));

      const response = await DELETE({} as Request, { params: Promise.resolve({ id: 'sermon-1' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe('Не удалось удалить проповедь');
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
