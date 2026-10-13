import { adminDb } from '@/config/firebaseAdminConfig';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';

import * as sermonsRouteModule from 'app/api/sermons/route';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
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
  getRequiredAuthenticatedUid: jest.fn(),
}));

/**
 * POST /api/sermons stays for shipped bundles. Sermons are created only through the data engine,
 * so an old bundle's create is refused with 426 and nothing is written.
 */
describe('Sermons API Route POST (legacy write route, closed)', () => {
  const request = () => new Request('http://localhost/api/sermons', {
    method: 'POST',
    body: JSON.stringify({ title: 'New Sermon', verse: 'Matthew 5:1-12', date: '2023-02-01', thoughts: [] }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses a caller without a verified token and writes nothing', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue(null);
    expect((await sermonsRouteModule.POST(request())).status).toBe(401);
    expect(adminDb.collection).not.toHaveBeenCalled();
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('refuses an authenticated create with the data-engine refusal and writes nothing', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('user123');
    const response = await sermonsRouteModule.POST(request());
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
    expect(adminDb.collection).not.toHaveBeenCalled();
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });
});
