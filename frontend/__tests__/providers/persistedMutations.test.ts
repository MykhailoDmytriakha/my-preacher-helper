import { get, update } from 'idb-keyval';

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
jest.mock('idb-keyval', () => ({ createStore: jest.fn(), get: jest.fn(), update: jest.fn() }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
const failedToggle = {
  mutationKey: ['user-settings', 'showAppVersion'],
  state: { variables: { userId: 'owner', value: true }, status: 'error', isPaused: false, submittedAt: 15, error: { code: 'data-engine-required' } },
};
const failedOptionalCategoryWrite = {
  mutationKey: ['prayerCategories', 'update'],
  state: { variables: { userId: 'owner', id: 'category-1', updates: { name: 'Offline category' } }, status: 'error', isPaused: false, submittedAt: 17, error: { code: 'unavailable' } },
};
const pausedOptionalCategoryWrite = {
  mutationKey: ['prayerCategories', 'update'],
  state: { variables: { userId: 'owner', id: 'category-2', updates: { color: 'blue' } }, status: 'pending', isPaused: true, submittedAt: 18 },
};
const pausedNoteEdit = {
  mutationKey: ['study-notes', 'update'],
  state: { variables: { id: 'note-1', userId: 'owner', updates: { content: 'Typed offline' } }, status: 'pending', isPaused: true, submittedAt: 16 },
};
type Saved = typeof failedToggle | typeof failedOptionalCategoryWrite | typeof pausedOptionalCategoryWrite | typeof pausedNoteEdit;
/** What the running session writes back: the restored writes, through the app's own filter. */
const writtenBack = (mutations: Saved[]) => mutations.filter(mutation =>
  shouldDehydrateMutation({ state: mutation.state, options: { mutationKey: mutation.mutationKey } } as never));
const savedCache = (mutations: Saved[]) => ({ timestamp: 1, buster: '', clientState: { queries: [], mutations } });

afterEach(() => { delete process.env[ON_ENGINE]; });

it('does not bring back a copy the person removed once the session has written its cache', async () => {
  process.env[ON_ENGINE] = 'users';
  installStorageHarness();
  let stored: unknown = savedCache([failedToggle]);
  jest.mocked(get).mockImplementation(async key => key === 'react-query-cache' ? stored : undefined);
  jest.mocked(update).mockImplementation(async (key, updater) => {
    expect(key).toBe('react-query-cache');
    stored = updater(stored);
  });
  await preserveLegacyQueryCache(isCollectionOnEngine);
  const copies = await listLegacyQueryCopies('owner');
  expect(copies).toHaveLength(1);

  await removeLegacyCopies('owner', copies);
  stored = savedCache(writtenBack([failedToggle, pausedNoteEdit]));
  await preserveLegacyQueryCache(isCollectionOnEngine);

  expect(await listLegacyQueryCopies('owner')).toEqual([]);
});

it('keeps failed and paused writes on an optional legacy collection in the saved cache', () => {
  expect(writtenBack([failedOptionalCategoryWrite, pausedOptionalCategoryWrite])).toHaveLength(2);
  // Settings keys are archived/refused regardless of activation switches, not resumed from this cache.
  expect(writtenBack([failedToggle])).toHaveLength(0);
  expect(shouldDehydrateMutation({ state: failedToggle.state, options: { mutationKey: failedToggle.mutationKey } } as never)).toBe(false);
  expect(shouldDehydrateMutation({ state: { isPaused: false, status: 'pending' }, options: { mutationKey: ['user-settings', 'showAppVersion'] } } as never)).toBe(false);
  expect(shouldDehydrateMutation({ state: pausedOptionalCategoryWrite.state, options: { mutationKey: pausedOptionalCategoryWrite.mutationKey } } as never)).toBe(true);
  expect(shouldDehydrateMutation({ state: { isPaused: true, status: 'pending' }, options: {} } as never)).toBe(true);
});
