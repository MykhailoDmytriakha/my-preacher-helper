import { ownsPreparationCopy, preparationCopyText, preparationEcho, readLegacyPreparation, removeLegacyPreparation } from '../legacyPreparationRecovery';
import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/react.client', () => ({
  discoverLegacyRecovery: jest.requireActual('@/data-engine/legacyRecovery.client').discoverLegacyRecovery,
}));

const snapshot = (value: Record<string, unknown> = {}): ResourceSnapshot => ({
  resource: { collection: 'sermons', id: 'sermon' },
  value: { userId: 'owner', title: 'Current title', ...value },
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
});
const key = 'draft:v1:owner:sermon:preparation';
const backup = 'prep-draft-backup-sermon';
const raw = JSON.stringify({ savedAt: 10, value: { authorIntent: 'Unsent words' }, future: 'preserve this field' }, null, 3);

describe('historical preparation originals', () => {
  beforeEach(() => localStorage.clear());

  it('discovers only both exact formats for the authenticated owned sermon and keeps every original byte', () => {
    localStorage.setItem(key, raw);
    const oldRaw = JSON.stringify({ thesis: { homiletical: 'Older words' } }, null, 2);
    localStorage.setItem(backup, oldRaw);
    localStorage.setItem('draft:v1:foreign:sermon:preparation', raw);
    localStorage.setItem('draft:v1:owner:other:preparation', raw);
    localStorage.setItem('draft:v1:owner:sermon:note', raw);
    const copies = readLegacyPreparation('owner', snapshot());
    expect(copies).toHaveLength(2);
    expect(copies.map(copy => copy.raw)).toEqual([raw, oldRaw]);
    expect(copies[0].value).toEqual({ authorIntent: 'Unsent words' });
    expect(localStorage.getItem(key)).toBe(raw);
    expect(localStorage.getItem(backup)).toBe(oldRaw);
    expect(localStorage.length).toBe(5);
  });

  it('never assigns an owner to a backup using foreign, absent or deleted evidence', () => {
    localStorage.setItem(backup, JSON.stringify({ authorIntent: 'Private old words' }));
    expect(ownsPreparationCopy(null, snapshot())).toBe(false);
    expect(ownsPreparationCopy('owner', null)).toBe(false);
    for (const invalid of [
      snapshot({ userId: 'foreign' }),
      { ...snapshot(), value: null },
      { ...snapshot(), metadata: { ...snapshot().metadata!, deleted: true } },
      { ...snapshot(), resource: { collection: 'groups', id: 'sermon' } },
    ]) expect(readLegacyPreparation('owner', invalid)).toEqual([]);
    expect(localStorage.getItem(backup)).not.toBeNull();
  });

  it.each(['{', 'true', 'null', '[]', '"words"'])('keeps an unreadable or nonobject backup intact: %s', value => {
    localStorage.setItem(backup, value);
    expect(readLegacyPreparation('owner', snapshot())).toEqual([]);
    expect(localStorage.getItem(backup)).toBe(value);
  });

  it('does not mistake a draft of another aggregate or a scalar for preparation', () => {
    localStorage.setItem(key, JSON.stringify({ value: 'Not a preparation object', savedAt: 10 }));
    expect(readLegacyPreparation('owner', snapshot())).toEqual([]);
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('compares the whole preparation field with key-order normalization and ignores other sermon fields', () => {
    localStorage.setItem(key, JSON.stringify({ value: { thesis: { homiletical: 'Same words', exegetical: 'Other words' }, authorIntent: 'Keep' } }));
    const [copy] = readLegacyPreparation('owner', snapshot());
    const server = snapshot({ title: 'Unrelated new title', preparation: { authorIntent: 'Keep', thesis: { exegetical: 'Other words', homiletical: 'Same words' } } });
    expect(preparationEcho(copy, server)).toBe(true);
    expect(preparationEcho(copy, snapshot({ preparation: { ...copy.value, future: 'Extra saved words' } }))).toBe(false);
    expect(preparationEcho(copy, snapshot({ preparation: { ...copy.value, authorIntent: 'Newer words' } }))).toBe(false);
    expect(preparationEcho(copy, { ...server, resource: { collection: 'sermons', id: 'other' } })).toBe(false);
    expect(preparationEcho(copy, snapshot({ userId: 'foreign', preparation: copy.value }))).toBe(false);
    expect(preparationEcho(copy, { ...server, value: null })).toBe(false);
  });

  it('treats an empty preparation as equal to an absent field but not to a nonempty draft', () => {
    localStorage.setItem(key, JSON.stringify({ value: {} }));
    expect(preparationEcho(readLegacyPreparation('owner', snapshot())[0], snapshot())).toBe(true);
    localStorage.setItem(key, raw);
    expect(preparationEcho(readLegacyPreparation('owner', snapshot())[0], snapshot())).toBe(false);
  });

  it('removes only the exact original; a replacement with equal words and a newer savedAt stays', () => {
    localStorage.setItem(key, raw);
    const [copy] = readLegacyPreparation('owner', snapshot());
    const replacement = JSON.stringify({ value: copy.value, savedAt: 20 });
    localStorage.setItem(key, replacement);
    expect(removeLegacyPreparation(copy, 'owner', snapshot())).toBe(false);
    expect(localStorage.getItem(key)).toBe(replacement);
    localStorage.setItem(key, raw);
    expect(removeLegacyPreparation(copy, 'foreign', snapshot())).toBe(false);
    const foreignKey = 'draft:v1:foreign:sermon:preparation';
    localStorage.setItem(foreignKey, raw);
    expect(removeLegacyPreparation({ ...copy, key: foreignKey }, 'owner', snapshot())).toBe(false);
    expect(localStorage.getItem(foreignKey)).toBe(raw);
    expect(removeLegacyPreparation(copy, 'owner', { ...snapshot(), resource: { collection: 'sermons', id: 'other' } })).toBe(false);
    expect(removeLegacyPreparation(copy, 'owner', snapshot())).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('surfaces storage failure rather than claiming discovery or removal succeeded', () => {
    localStorage.setItem(key, raw);
    const [copy] = readLegacyPreparation('owner', snapshot());
    const storage = { length: 1, key: () => key, getItem: () => { throw new Error('Storage refused'); }, removeItem: jest.fn() };
    expect(() => readLegacyPreparation('owner', snapshot(), storage)).toThrow('Storage refused');
    expect(() => removeLegacyPreparation(copy, 'owner', snapshot(), storage)).toThrow('Storage refused');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps every nested word, ordered item and flag in the readable copy', () => {
    const text = preparationCopyText({ authorIntent: 'First words', thesis: { homiletical: 'Second words' }, future: ['Third words', { text: 'Fourth words' }], spiritual: { readAndPrayedConfirmed: false } }, field => 'Label ' + field, flag => flag ? 'Yes' : 'No');
    expect(text).toContain('Label authorIntent:\n  First words');
    for (const word of ['Second words', 'Third words', 'Fourth words', 'No']) expect(text).toContain(word);
    expect(text.indexOf('Third words')).toBeLessThan(text.indexOf('Fourth words'));
  });
});
