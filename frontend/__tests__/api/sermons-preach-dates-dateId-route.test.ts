import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sermonsRepository } from '@repositories/sermons.repository';

import {
  DELETE,
  PUT,
} from 'app/api/sermons/[id]/preach-dates/[dateId]/route';

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
  },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('user-1'),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

describe('/api/sermons/[id]/preach-dates/[dateId] route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({ id: 's1', userId: 'user-1' });
  });

  describe.each([['PUT', PUT], ['DELETE', DELETE]] as const)('%s (legacy write route, closed)', (method, handler) => {
    const call = () => handler(new Request('http://localhost/api/sermons/s1/preach-dates/pd1', { method }));

    it('answers 401 without a verified token and reads nothing', async () => {
      (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);
      expect((await call()).status).toBe(401);
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });

    it('answers 426 data-engine-required with a token and writes nothing', async () => {
      const response = await call();
      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });
  });
});
