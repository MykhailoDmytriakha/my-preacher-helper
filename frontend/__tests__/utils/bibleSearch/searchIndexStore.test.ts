import { prepareWordForms } from '../../../test-utils/bibleWordForms';

prepareWordForms(["ru"]);

import { act, renderHook, waitFor } from '@testing-library/react';

import { loadSearchIndex, resetSearchIndexesForTests, searchIndexState, useSearchIndex } from '@/utils/bibleSearch/searchIndexStore';
import { fetchBookText, keptBookText } from '@/utils/bibleText';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

/*
 * Books saved on the device are searchable at once, whatever the network does: a stalled download of
 * another book never keeps them out (Codex review of the search line, 2026-10-23).
 */
jest.mock('@/utils/bibleText', () => ({
  ...jest.requireActual('@/utils/bibleText'),
  keptBookText: jest.fn(),
  fetchBookText: jest.fn(),
}));

const john = { id: 'John', chapters: [['В начале было Слово']] };

beforeEach(() => {
  resetSearchIndexesForTests();
  __resetConnectivityForTests();
  (keptBookText as jest.Mock).mockImplementation(async (bookId: string) => (bookId === 'John' ? john : null));
  // The network never answers.
  (fetchBookText as jest.Mock).mockImplementation(() => new Promise(() => undefined));
});

it('indexes the saved books before it asks the network for the rest', async () => {
  const order = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'John'];
  void loadSearchIndex('rst', order);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const state = searchIndexState('rst', order);
  expect(state.index.has('John')).toBe(true);
  expect(state.indexed).toBe(1);
  expect(state.loading).toBe(true);
});

it('asks again for a book that failed when the connection returns during a load', async () => {
  (keptBookText as jest.Mock).mockResolvedValue(null);
  let release: (text: unknown) => void = () => undefined;
  const exodus = new Promise((resolve) => { release = resolve; });
  (fetchBookText as jest.Mock).mockImplementation((bookId: string) =>
    bookId === 'Genesis' ? Promise.reject(new Error('offline')) : exodus);
  const order = ['Genesis', 'Exodus'];
  const first = loadSearchIndex('rst', order);
  await new Promise((resolve) => setTimeout(resolve, 0));
  void loadSearchIndex('rst', order);           // the connection came back mid-run
  release({ id: 'Exodus', chapters: [['Вот имена сынов Израилевых']] });
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const genesisAsks = (fetchBookText as jest.Mock).mock.calls.filter(([bookId]) => bookId === 'Genesis');
  expect(genesisAsks).toHaveLength(2);
});


it('waits for the server and retries missing search books without another browser online event', async () => {
  const order = ['John', 'Ruth'];
  let available = false;
  (fetchBookText as jest.Mock).mockImplementation(async () => {
    if (!available) throw new Error('offline');
    return { id: 'Ruth', chapters: [['Now it came to pass in the days when the judges ruled']] };
  });
  const { result } = renderHook(() => useSearchIndex('kjv', order, true));
  await waitFor(() => expect(result.current.missing).toBe(1));
  expect(result.current.index.has('John')).toBe(true);
  expect(fetchBookText).toHaveBeenCalledTimes(1);

  act(() => reportServerUnreachable());
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(fetchBookText).toHaveBeenCalledTimes(1);

  available = true;
  act(() => reportServerReachable());
  await waitFor(() => expect(result.current.index.has('Ruth')).toBe(true));
  expect(result.current.index.has('John')).toBe(true);
  expect(result.current.missing).toBe(0);
  expect(fetchBookText).toHaveBeenCalledTimes(2);
});


it('checks availability again before replaying a search batch queued while the first ran', async () => {
  const order = ['Ruth'];
  let reject: (error: Error) => void = () => undefined;
  jest.mocked(fetchBookText)
    .mockImplementationOnce(() => new Promise((_, refuse) => { reject = refuse; }))
    .mockResolvedValueOnce({ id: 'Ruth', chapters: [['Now it came to pass']] });
  const { result } = renderHook(() => useSearchIndex('kjv', order, true));
  await waitFor(() => expect(fetchBookText).toHaveBeenCalledTimes(1));
  await act(async () => { reportServerUnreachable(); reportServerReachable(); });
  act(() => reportServerUnreachable());
  await act(async () => reject(new Error('offline')));
  await waitFor(() => expect(result.current.missing).toBe(1));
  expect(fetchBookText).toHaveBeenCalledTimes(1);
  act(() => reportServerReachable());
  await waitFor(() => expect(result.current.index.has('Ruth')).toBe(true));
  expect(fetchBookText).toHaveBeenCalledTimes(2);
});


it('keeps an explicit search retry when a later automatic retry can no longer run', async () => {
  const order = ['Ruth'];
  let reject: (error: Error) => void = () => undefined;
  jest.mocked(fetchBookText)
    .mockImplementationOnce(() => new Promise((_, refuse) => { reject = refuse; }))
    .mockResolvedValueOnce({ id: 'Ruth', chapters: [['Now it came to pass']] });
  const { result } = renderHook(() => useSearchIndex('kjv', order, true));
  await waitFor(() => expect(fetchBookText).toHaveBeenCalledTimes(1));
  void loadSearchIndex('kjv', order);
  await act(async () => { reportServerUnreachable(); reportServerReachable(); });
  act(() => reportServerUnreachable());
  await act(async () => reject(new Error('offline')));
  await waitFor(() => expect(result.current.index.has('Ruth')).toBe(true));
  expect(fetchBookText).toHaveBeenCalledTimes(2);
});
