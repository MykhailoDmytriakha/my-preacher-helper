/** @jest-environment node */
import { loadWordFormLexicon, lexicalFormsOf, resetWordFormLexiconsForTests, wordFormLexiconReady } from '@/utils/bibleSearch/wordFormLexicon';
import type { WordFormData } from '@/utils/bibleSearch/wordFormAssets';

import { readWordFormFixture } from '../../../test-utils/bibleWordForms';

beforeEach(() => { resetWordFormLexiconsForTests(); });

it('does not invent lexical results before the selected language is ready', () => {
  expect(wordFormLexiconReady('ru')).toBe(false);
  expect(wordFormLexiconReady('uk')).toBe(false);
  expect(() => lexicalFormsOf('дело', 'ru')).toThrow('not ready');
});

it('shares one pending selected-language load and preserves verified admission', async () => {
  let release!: (value: WordFormData) => void;
  const read = jest.fn(() => new Promise<WordFormData>(resolve => { release = resolve; }));
  const first = loadWordFormLexicon('ru', read), second = loadWordFormLexicon('ru', read);
  expect(first).toBe(second);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('ru');
  expect(wordFormLexiconReady('ru')).toBe(false);
  release(readWordFormFixture('ru')); await first;
  expect(wordFormLexiconReady('ru')).toBe(true);
  expect(wordFormLexiconReady('uk')).toBe(false);
  expect(lexicalFormsOf('дело', 'ru')?.words.has('дела')).toBe(true);
  expect(lexicalFormsOf('дело', 'ru')?.words.has('для')).toBe(false);
  await loadWordFormLexicon('ru', read);
  expect(read).toHaveBeenCalledTimes(1);
});

it('can retry a refused load without retaining its rejected promise', async () => {
  const refusal = new Error('Dictionary unavailable');
  const read = jest.fn().mockRejectedValueOnce(refusal).mockResolvedValueOnce(readWordFormFixture('ru'));
  await expect(loadWordFormLexicon('ru', read)).rejects.toBe(refusal);
  expect(wordFormLexiconReady('ru')).toBe(false);
  await loadWordFormLexicon('ru', read);
  expect(wordFormLexiconReady('ru')).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
});
