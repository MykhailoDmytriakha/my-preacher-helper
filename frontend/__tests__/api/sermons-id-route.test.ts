import { sermonsRepository } from '@repositories/sermons.repository';
import { seriesRepository } from '@repositories/series.repository';

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
