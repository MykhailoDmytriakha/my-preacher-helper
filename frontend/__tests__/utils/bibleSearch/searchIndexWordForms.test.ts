import { waitFor } from '@testing-library/react';

import { SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { answeringOf } from '@/utils/bibleSearch/lineChoice';
import { readLine } from '@/utils/bibleSearch/query';
import { loadSearchIndex, resetSearchIndexesForTests, searchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import { resetWordFormLexiconsForTests, wordFormLexiconReady } from '@/utils/bibleSearch/wordFormLexicon';
import { fetchBookText, keptBookText } from '@/utils/bibleText';

import { readWordFormFixture } from '../../../test-utils/bibleWordForms';

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'),
  keptBookText: jest.fn(), fetchBookText: jest.fn(),
}));
const john = { id: 'John', chapters: [['дело Господа', 'для человеков']] };
const order = ['John'];
const fetchMock = fetch as jest.MockedFunction<typeof fetch>;
const dictionary = () => new Response(JSON.stringify(readWordFormFixture('ru')), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetSearchIndexesForTests(); resetWordFormLexiconsForTests(); fetchMock.mockReset();
  (keptBookText as jest.Mock).mockResolvedValue(john);
  (fetchBookText as jest.Mock).mockRejectedValue(new Error('No network text'));
});

it('can prepare place previews and parse a place without requesting lexical data', async () => {
  await loadSearchIndex('rst', order, false);
  expect(searchIndexState('rst', order).index.has('John')).toBe(true);
  expect(readLine('Ин 3:16', { bible: 'rst', books: SYNODAL_BOOKS }).kind).toBe('place');
  expect(readLine('дело', { bible: 'rst', books: SYNODAL_BOOKS }).kind).toBe('search');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(wordFormLexiconReady('ru')).toBe(false);
});

it('does not request a dictionary for English word search', async () => {
  await loadSearchIndex('kjv', order);
  expect(searchIndexState('kjv', order).wordFormsReady).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('waits for verified lexical data even when every requested book is already indexed', async () => {
  await loadSearchIndex('rst', order, false);
  let release!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const loading = loadSearchIndex('rst', order);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const pending = searchIndexState('rst', order);
  expect(pending.loading).toBe(true); expect(pending.wordFormsReady).toBe(false);
  const reading = readLine('дело', { bible: 'rst', books: SYNODAL_BOOKS });
  expect(answeringOf(pending.index, pending.indexed, SYNODAL_BOOKS, pending.wordFormsReady).answerFor(reading)).toBeNull();
  release(dictionary()); await loading;
  const ready = searchIndexState('rst', order);
  expect(ready.wordFormsReady).toBe(true); expect(ready.loading).toBe(false);
  expect(answeringOf(ready.index, ready.indexed, SYNODAL_BOOKS, ready.wordFormsReady).answerFor(reading)?.hits.map(hit => hit.verse)).toEqual([1]);
});

it('retains the real load failure through an unrelated book-only load, then permits explicit retry', async () => {
  await loadSearchIndex('rst', order, false);
  fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
  await loadSearchIndex('rst', order);
  const refusal = searchIndexState('rst', order).wordFormsError;
  expect(refusal?.message).toContain('503');
  expect(searchIndexState('rst', order).loading).toBe(false);
  await loadSearchIndex('rst', ['John', 'Genesis'], false);
  expect(searchIndexState('rst', order).wordFormsError).toBe(refusal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(dictionary());
  await loadSearchIndex('rst', order);
  expect(searchIndexState('rst', order).wordFormsReady).toBe(true);
  expect(searchIndexState('rst', order).wordFormsError).toBeNull();
});


it('starts lexical preparation while an unrelated text download is still pending', async () => {
  (keptBookText as jest.Mock).mockImplementation(async id => id === 'John' ? john : null);
  let releaseText!: (value: unknown) => void;
  const text = new Promise(resolve => { releaseText = resolve; });
  (fetchBookText as jest.Mock).mockReturnValue(text);
  const first = loadSearchIndex('rst', ['John', 'Genesis'], false);
  await waitFor(() => expect(fetchBookText).toHaveBeenCalledTimes(1));
  fetchMock.mockResolvedValueOnce(dictionary());
  const searched = loadSearchIndex('rst', ['John', 'Genesis']);
  try {
    await waitFor(() => expect(searchIndexState('rst', order).wordFormsReady).toBe(true));
    expect(searchIndexState('rst', order).index.has('Genesis')).toBe(false);
  } finally {
    releaseText({ id: 'Genesis', chapters: [['Начало']] });
    await first; await searched;
  }
});

it('honors a reconnect requested before a failed lexical request settles', async () => {
  await loadSearchIndex('rst', order, false);
  let refuse!: (reason: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
  const first = loadSearchIndex('rst', order);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fetchMock.mockResolvedValueOnce(dictionary());
  const online = loadSearchIndex('rst', order);
  refuse(new Error('Previous request failed after reconnect'));
  await first; await online;
  await waitFor(() => expect(searchIndexState('rst', order).wordFormsReady).toBe(true));
  expect(searchIndexState('rst', order).wordFormsError).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
