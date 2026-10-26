import { loadSearchIndex, resetSearchIndexesForTests, searchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import { fetchBookText, keptBookText } from '@/utils/bibleText';

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
