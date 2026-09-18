import { seriesRepository } from '@repositories/series.repository';

import { DELETE } from 'app/api/series/[id]/route';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {} }));
jest.mock('@repositories/series.repository', () => ({ seriesRepository: {
  fetchSeriesById: jest.fn(), deleteSeriesAndDetach: jest.fn(),
} }));
jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, options: { status?: number } = {}) => ({
  status: options.status || 200, json: async () => data,
}) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('user-1') }));

describe('/api/series/[id] DELETE', () => {
  const remove = () => DELETE({} as Request, { params: Promise.resolve({ id: 's1' }) });
  beforeEach(() => {
    jest.clearAllMocks();
    (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({ id: 's1', userId: 'user-1' });
    (seriesRepository.deleteSeriesAndDetach as jest.Mock).mockResolvedValue(undefined);
  });
  it('returns success when already missing', async () => {
    (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue(null);
    expect((await remove()).status).toBe(200);
    expect(seriesRepository.deleteSeriesAndDetach).not.toHaveBeenCalled();
  });
  it('delegates the entire cascade to one atomic repository operation', async () => {
    expect((await remove()).status).toBe(200);
    expect(seriesRepository.deleteSeriesAndDetach).toHaveBeenCalledWith('s1', 'user-1');
  });
  it('refuses foreign ownership before deletion', async () => {
    (seriesRepository.fetchSeriesById as jest.Mock).mockResolvedValue({ userId: 'other' });
    expect((await remove()).status).toBe(403);
    expect(seriesRepository.deleteSeriesAndDetach).not.toHaveBeenCalled();
  });
  it('surfaces protected cascade refusal instead of reporting success', async () => {
    (seriesRepository.deleteSeriesAndDetach as jest.Mock).mockRejectedValue(Object.assign(new Error('data-engine-required'), { code: 'data-engine-required' }));
    const response = await remove();
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
  });
  it('returns 500 on ordinary deletion failure', async () => {
    (seriesRepository.deleteSeriesAndDetach as jest.Mock).mockRejectedValue(new Error('boom'));
    expect((await remove()).status).toBe(500);
  });
});
