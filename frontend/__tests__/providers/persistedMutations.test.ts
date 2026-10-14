import { get } from 'idb-keyval';

import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';
import { listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies } from '@/data-engine/legacyQueryRecovery.client';
import { isCollectionOnEngine } from '@/data-engine/react.client';
import { shouldDehydrateMutation } from '@/providers/QueryProvider';

/**
 * A COPY THE PERSON REMOVED STAYS REMOVED (BUG-20261013-legacy-copies-return-after-accept).
 *
 * Every start archives the failed and paused writes it finds in the saved query cache as "copies
 * from the previous version". A write of a collection the engine now owns was saved there again by
 * the running session, so after "Accept everything from the server" the next start archived it
 * anew and the notice came back.
 */
jest.mock('idb-keyval', () => ({ createStore: jest.fn(), get: jest.fn() }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
const failedToggle = {
  mutationKey: ['user-settings', 'showAppVersion'],
  state: { variables: { userId: 'owner', value: true }, status: 'error', isPaused: false, submittedAt: 15, error: { code: 'data-engine-required' } },
};
const pausedNoteEdit = {
  mutationKey: ['study-notes', 'update'],
  state: { variables: { id: 'note-1', userId: 'owner', updates: { content: 'Typed offline' } }, status: 'pending', isPaused: true, submittedAt: 16 },
};
type Saved = typeof failedToggle | typeof pausedNoteEdit;
/** What the running session writes back: the restored writes, through the app's own filter. */
const writtenBack = (mutations: Saved[]) => mutations.filter(mutation =>
  shouldDehydrateMutation({ state: mutation.state, options: { mutationKey: mutation.mutationKey } } as never));
const savedCache = (mutations: Saved[]) => ({ timestamp: 1, buster: '', clientState: { queries: [], mutations } });

afterEach(() => { delete process.env[ON_ENGINE]; });

it('does not bring back a copy the person removed once the session has written its cache', async () => {
  process.env[ON_ENGINE] = 'users';
  installStorageHarness();
  jest.mocked(get).mockResolvedValue(savedCache([failedToggle]));
  await preserveLegacyQueryCache(isCollectionOnEngine);
  const copies = await listLegacyQueryCopies('owner');
  expect(copies).toHaveLength(1);

  await removeLegacyCopies('owner', copies);
  jest.mocked(get).mockResolvedValue(savedCache(writtenBack([failedToggle, pausedNoteEdit])));
  await preserveLegacyQueryCache(isCollectionOnEngine);

  expect(await listLegacyQueryCopies('owner')).toEqual([]);
});

it('keeps a failed or paused write in the saved cache while its collection is still on the old road', () => {
  // Users off the engine: the settings toggle is replayed by the old writer, so it must survive a restart.
  expect(writtenBack([failedToggle])).toHaveLength(1);
  expect(shouldDehydrateMutation({ state: { isPaused: false, status: 'pending' }, options: { mutationKey: ['user-settings', 'showAppVersion'] } } as never)).toBe(false);
  expect(shouldDehydrateMutation({ state: { isPaused: true, status: 'pending' }, options: {} } as never)).toBe(true);
});
