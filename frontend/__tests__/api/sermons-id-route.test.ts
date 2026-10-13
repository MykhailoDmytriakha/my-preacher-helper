import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sermonsRepository } from '@repositories/sermons.repository';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
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
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('user-1');
  });

  describe('DELETE (legacy write route, closed)', () => {
    const run = () => DELETE(new Request('http://localhost/api/sermons/sermon-1', { method: 'DELETE' }));

    it('answers 401 without a verified token and reads nothing', async () => {
      (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);
      expect((await run()).status).toBe(401);
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });

    it('answers 426 data-engine-required with a token and touches no repository', async () => {
      const response = await run();
      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });
  });
});
