import { createStore, del, entries, update } from 'idb-keyval';
import { createIndexedDbJournal } from '../journal.client';
import type { JournalEntry } from '../types';
jest.mock('idb-keyval', () => ({ createStore: jest.fn(() => 'store'), del: jest.fn(), entries: jest.fn(), update: jest.fn() }));
const entry = (owner = 'owner'): JournalEntry => ({ command: { protocol: 1, operationId: 'op', owner, resource: { collection: 'studies', id: 'one' }, generation: null, dependsOn: [], kind: 'create', value: { text: 'mine' } }, state: 'queued', attempts: 0, createdAt: 1 });
describe('IndexedDB journal boundary', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it('awaits durable commit and rejects identity reuse atomically', async () => {
    const journal = createIndexedDbJournal();
    let complete!: () => void;
    let mutate!: (current?: JournalEntry) => JournalEntry;
    jest.mocked(update).mockImplementation((_key, callback) => { mutate = callback as typeof mutate; return new Promise<void>(resolve => { complete = resolve; }); });
    let saved = false;
    const pending = journal.put(entry()).then(() => { saved = true; });
    expect(saved).toBe(false);
    expect(mutate()).toEqual(entry());
    expect(mutate(entry())).toEqual(entry());
    const settled = { ...entry(), state: 'acknowledged' as const };
    expect(mutate(settled)).toEqual(settled);
    expect(() => mutate({ ...entry(), command: { ...entry().command, kind: 'create', value: { text: 'different' } } })).toThrow('identity');
    complete();
    await pending;
    expect(saved).toBe(true);
    expect(createStore).toHaveBeenCalledTimes(1);
  });
  it('partitions owners with collision safe keys and removes only the specified owner', async () => {
    const journal = createIndexedDbJournal();
    const later = { ...entry(), command: { ...entry().command, operationId: 'later' }, createdAt: 3 };
    jest.mocked(entries).mockResolvedValue([[JSON.stringify(['owner', 'later']), later], [JSON.stringify(['owner', 'op']), entry()], [JSON.stringify(['other', 'op']), entry('other')], ['wrong key', entry()]]);
    expect(await journal.list('owner')).toEqual([entry(), later]);
    await journal.remove('owner', 'op');
    expect(del).toHaveBeenCalledWith(JSON.stringify(['owner', 'op']), 'store');
  });
  it('propagates storage refusal without reporting durability', async () => {
    jest.mocked(update).mockRejectedValue(new Error('QuotaExceededError'));
    await expect(createIndexedDbJournal().put(entry())).rejects.toThrow('QuotaExceededError');
  });
});
