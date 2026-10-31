import { QueryClient, dehydrate } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

import { createIDBPersister } from '@/utils/queryPersister';

jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

it('keeps an unread offline queue when the library tries to remove a cache after a failed read', async () => {
  const source = new QueryClient();
  source.getMutationCache().build(source, { mutationKey: ['study-note-share-links', 'create'] }, {
    context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
    isPaused: true, status: 'pending', variables: { userId: 'A', noteId: 'note-A' }, submittedAt: Date.now(),
  });
  const original = { timestamp: Date.now(), buster: '', clientState: dehydrate(source) };
  let saved: typeof original | undefined = original;
  jest.mocked(get).mockRejectedValueOnce(new Error('A single storage read failed'));
  jest.mocked(del).mockImplementation(async () => { saved = undefined; });
  const client = new QueryClient();
  const persister = createIDBPersister();
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await expect(persistQueryClientRestore({ queryClient: client, persister, maxAge: Infinity })).rejects.toThrow('A single storage read failed');
    expect(saved).toBe(original);
    expect(del).not.toHaveBeenCalled();
    await persister.persistClient({ timestamp: Date.now(), buster: '', clientState: { queries: [], mutations: [] } });
    expect(set).not.toHaveBeenCalled();
  } finally {
    error.mockRestore(); warning.mockRestore(); source.clear(); client.clear();
  }
});
