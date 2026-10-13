const mockApiClient = jest.fn();
const mockGetSermonsViaClient = jest.fn();
const mockGetSermonByIdViaClient = jest.fn();
const mockUpdateSermonViaClient = jest.fn();
const mockUpdateSermonPreparationViaClient = jest.fn();

jest.mock('@/utils/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}));

jest.mock('@/services/sermons.client', () => ({
  getSermonsViaClient: (...args: unknown[]) => mockGetSermonsViaClient(...args),
  getSermonByIdViaClient: (...args: unknown[]) => mockGetSermonByIdViaClient(...args),
  updateSermonViaClient: (...args: unknown[]) => mockUpdateSermonViaClient(...args),
  updateSermonPreparationViaClient: (...args: unknown[]) => mockUpdateSermonPreparationViaClient(...args),
}));

import {
  createSermon,
  deleteSermon,
  getSermonById,
  getSermons,
  updateSermon,
  updateSermonPreparation,
} from '@/services/sermon.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

describe('sermon.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes reads and own-doc updates through the client SDK', async () => {
    const sermons = [{ id: 's1', userId: 'u1', title: 'Sermon' }];
    const sermon = { id: 's1', userId: 'u1', title: 'Updated' };
    const preparation = { targetAudience: 'Youth' };

    mockGetSermonsViaClient.mockResolvedValueOnce(sermons);
    mockGetSermonByIdViaClient.mockResolvedValueOnce(sermon);
    mockUpdateSermonViaClient.mockResolvedValueOnce(sermon);
    mockUpdateSermonPreparationViaClient.mockResolvedValueOnce(preparation);

    await expect(getSermons('u1')).resolves.toBe(sermons);
    await expect(getSermonById('s1')).resolves.toBe(sermon);
    await expect(updateSermon(sermon as any)).resolves.toBe(sermon);
    await expect(updateSermonPreparation('s1', preparation as any)).resolves.toBe(preparation);

    expect(mockGetSermonsViaClient).toHaveBeenCalledWith('u1');
    expect(mockGetSermonByIdViaClient).toHaveBeenCalledWith('s1');
    // Third argument = expectedRevision; null means "unguarded", as before.
    // Fourth argument = content fingerprint; `undefined` when the caller does not
    // supply one, which keeps the counter-only behaviour for unmigrated paths.
    expect(mockUpdateSermonViaClient).toHaveBeenCalledWith(sermon, undefined, null, undefined);
    expect(mockUpdateSermonPreparationViaClient).toHaveBeenCalledWith('s1', preparation, undefined);
    expect(mockApiClient).not.toHaveBeenCalled();
  });

  // Sermons are engine-owned: create and delete go only through the data engine, and the legacy
  // service refuses before any request.
  it.each([
    ['create', () => createSermon({ title: 'Test', verse: 'John 3:16', date: '2024-01-01', userId: 'u1', thoughts: [] } as never)],
    ['delete', () => deleteSermon('s1')],
  ])('refuses a legacy %s before any request', async (_name, write) => {
    await expect(write()).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(mockApiClient).not.toHaveBeenCalled();
  });
});
