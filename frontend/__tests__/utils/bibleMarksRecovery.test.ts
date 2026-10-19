import { decodeCompleteBookMarks } from '@/utils/bibleMarks';
import { bibleMarksRecoveryValue } from '@/utils/bibleMarksRecovery';
import { documentScreenHref, isOnDocumentScreen } from '@/utils/documentScreenHref';
import en from '@locales/en/translation.json';

const t = (key: string, values?: Record<string, unknown>) => {
  const found = key.split('.').reduce<unknown>((value, field) => value && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined, en);
  return typeof found === 'string' ? found.replace(/{{(\w+)}}/g, (_, field: string) => String(values?.[field] ?? field)) : key;
};
const book = { userId: 'owner', bible: 'rst', book: 'Ruth' };
const resource = { collection: 'bibleMarks', id: 'owner_rst_ruth' };

it('shows the marked translation, both layers and one-based word ranges without changing stored values', () => {
  const verses = { v1_2: { p: '1-3-gray' }, v1_1: { m: '0-1-blue', p: '0-0-red' } };
  const original = JSON.stringify(verses);
  const shown = bibleMarksRecoveryValue(t, 'en', 'verses', verses, book);
  expect(shown).toContain('Ruth 1:1 — Marker: About man · Words 1–2; Pencil: About God · Words 1–1');
  expect(shown).toContain('Ruth 1:2 — Plain pencil · Words 2–4');
  expect(JSON.stringify(verses)).toBe(original);
});

it('shows an explicitly empty book instead of hiding a complete erasure', () => {
  expect(bibleMarksRecoveryValue(t, 'en', 'verses', {}, book)).toContain('Ruth — No marks');
});

it('understands complete legacy string-array layers through the canonical decoder', () => {
  expect(decodeCompleteBookMarks({ v1_1: { m: ['0-1-blue'] } })).toEqual({ '1:1': { m: [[0, 1, 'blue']] } });
});

it.each([
  { v1_1: { m: '0-1-unknown' } },
  { v1_1: { p: '0-1-unknown' } },
  { v1_1: { m: '0-1-blue', futureLayer: 'private mark' } },
  { notAVerse: { m: '0-1-blue' } },
  { v1_1: { m: ['0-1-blue', 'broken run'] } },
  { v1_1: { m: '', privateWords: 'Retain these words' } },
  ['0-1-blue'],
])('leaves unsupported or incomplete marks intact for the raw fallback: %p', verses => {
  expect(decodeCompleteBookMarks(verses)).toBeNull();
  expect(bibleMarksRecoveryValue(t, 'en', 'verses', verses, book)).toBe(verses);
});

it('does not hide an unknown authored document field', () => {
  expect(bibleMarksRecoveryValue(t, 'en', 'privateCaption', 'Keep these words', book)).toBe('Keep these words');
});

it.each([
  { ...book, bible: 'kjv' },
  { ...book, book: 'John' },
  { ...book, userId: 'another-owner' },
  { ...book, bible: 'future-bible' },
  { ...book, book: 'Unknown book' },
  null,
])('does not offer a misleading owning screen for mismatched metadata: %p', value => {
  expect(documentScreenHref(resource, value)).toBeNull();
});


it.each(['', '?book=john', '?book=ruth&read=kjv'])('does not identify another Bible screen as this held book: %s', search => {
  expect(isOnDocumentScreen('/bible', resource, book, search)).toBe(false);
});

it('identifies the owning book without mistaking reference numbering for the reading translation', () => {
  expect(isOnDocumentScreen('/bible', resource, book, '?book=ruth&tr=kjv')).toBe(true);
  expect(isOnDocumentScreen('/bible', resource, book, '?book=ruth&read=rst')).toBe(true);
});
