/** @jest-environment node */
import { warmBibleTextOnce, bookTextUrl } from '@/utils/bibleText';
import { BIBLE_TEXT_CACHE } from '@/utils/bibleTextCache';
import { type BibleId } from '@/utils/bibles';
import { fetchWordFormData } from '@/utils/bibleSearch/wordFormData';
import { WORD_FORMS_CACHE, wordFormDataUrl, type WordFormLanguage } from '@/utils/bibleSearch/wordFormAssets';

import { readWordFormFixture } from '../../test-utils/bibleWordForms';

class DeviceCache {
  rows = new Map<string, Response>();
  failPut = false;
  async match(url: string) { return this.rows.get(url)?.clone(); }
  async put(url: string, response: Response) {
    if (this.failPut) throw new Error('Storage refused');
    this.rows.set(url, response.clone());
  }
  async delete(url: string) { return this.rows.delete(url); }
}
function device() {
  const books = new DeviceCache(), forms = new DeviceCache();
  const storage = { open: async (name: string) => {
    if (name === BIBLE_TEXT_CACHE) return books;
    if (name === WORD_FORMS_CACHE) return forms;
    throw new Error(`Unexpected device cache ${name}`);
  } } as unknown as CacheStorage;
  return { books, forms, storage };
}
const payloads = { ru: readWordFormFixture('ru'), uk: readWordFormFixture('uk') };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const jude = { id: 'Jude', chapters: [['Jude, a servant of Jesus Christ']] };
const fetchMock = fetch as jest.MockedFunction<typeof fetch>;
beforeEach(() => { fetchMock.mockReset(); });
function network(bible: BibleId, language?: WordFormLanguage, refuseForms?: () => Response) {
  fetchMock.mockImplementation(async request => {
    if (request === bookTextUrl('Jude', bible)) return json(jude);
    if (language && request === wordFormDataUrl(language)) return refuseForms ? refuseForms() : json(payloads[language]);
    throw new Error(`Unexpected resource ${String(request)}`);
  });
}
const warm = (bible: BibleId, storage: CacheStorage) => warmBibleTextOnce({ bible, bookIds: ['Jude'], cacheStorage: storage });

it.each([['rst', 'ru'], ['ubio', 'uk']] as const)(
  'keeps %s word forms during ordinary Bible preparation before the first offline search', async (bible, language) => {
    const { books, forms, storage } = device(); network(bible, language);
    await expect(warm(bible, storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
    expect(books.rows.has(bookTextUrl('Jude', bible))).toBe(true);
    expect(forms.rows.has(wordFormDataUrl(language))).toBe(true);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([bookTextUrl('Jude', bible), wordFormDataUrl(language)]);
    expect(forms.rows.size).toBe(1);
    fetchMock.mockRejectedValue(new TypeError('Offline'));
    expect((await fetchWordFormData(language, { cacheStorage: storage })).entries).toHaveLength(payloads[language].entries.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

it('prepares English reading without either Russian or Ukrainian word data', async () => {
  const { forms, storage } = device(); network('kjv');
  await expect(warm('kjv', storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
  expect(forms.rows.size).toBe(0);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([bookTextUrl('Jude', 'kjv')]);
});

it('does not parse or download retained books and dictionary during a later visit', async () => {
  const { books, forms, storage } = device();
  books.rows.set(bookTextUrl('Jude', 'rst'), json(jude));
  forms.rows.set(wordFormDataUrl('ru'), json(payloads.ru));
  const read = jest.spyOn(Response.prototype, 'json');
  try {
    await expect(warm('rst', storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it('retries missing word data on the next preparation without discarding the kept book', async () => {
  const { books, forms, storage } = device();
  network('rst', 'ru', () => new Response('Unavailable', { status: 503 }));
  await expect(warm('rst', storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
  expect(books.rows.has(bookTextUrl('Jude', 'rst'))).toBe(true);
  expect(forms.rows.size).toBe(0);
  network('rst', 'ru');
  await expect(warm('rst', storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
  expect(forms.rows.has(wordFormDataUrl('ru'))).toBe(true);
  expect(fetchMock.mock.calls.filter(call => call[0] === bookTextUrl('Jude', 'rst'))).toHaveLength(1);
});

it('reports dictionary storage refusal while the same online search remains usable', async () => {
  const { books, forms, storage } = device(); forms.failPut = true; network('rst', 'ru');
  await expect(warm('rst', storage)).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: true });
  expect(books.rows.has(bookTextUrl('Jude', 'rst'))).toBe(true);
  expect(forms.rows.size).toBe(0);
  expect((await fetchWordFormData('ru', { cacheStorage: storage })).language).toBe('ru');
  expect(forms.rows.size).toBe(0);
});
