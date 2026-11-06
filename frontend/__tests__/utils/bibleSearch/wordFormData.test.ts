/** @jest-environment node */
import { fetchWordFormData } from '@/utils/bibleSearch/wordFormData';
import { WORD_FORMS_CACHE, wordFormDataUrl } from '@/utils/bibleSearch/wordFormAssets';

import { readWordFormFixture } from '../../../test-utils/bibleWordForms';

class DeviceCache {
  rows = new Map<string, Response>();
  deleted: string[] = [];
  failPut = false;
  async match(url: string) { return this.rows.get(url)?.clone(); }
  async put(url: string, response: Response) {
    if (this.failPut) throw new Error('Storage refused');
    this.rows.set(url, response.clone());
  }
  async delete(url: string) { this.deleted.push(url); return this.rows.delete(url); }
}
const storage = (cache: DeviceCache) => ({ open: async (name: string) => {
  expect(name).toBe(WORD_FORMS_CACHE); return cache;
} }) as unknown as CacheStorage;
const ru = readWordFormFixture('ru');
const uk = readWordFormFixture('uk');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

beforeEach(() => { fetchMock.mockReset(); });

it('requests only the selected content-addressed language and keeps it for a new offline load without a worker', async () => {
  const cache = new DeviceCache(), source = { cacheStorage: storage(cache) };
  fetchMock.mockResolvedValueOnce(json(ru));
  expect((await fetchWordFormData('ru', source)).language).toBe('ru');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(wordFormDataUrl('ru'));
  expect(cache.rows.has(wordFormDataUrl('ru'))).toBe(true);
  expect(cache.rows.has(wordFormDataUrl('uk'))).toBe(false);
  fetchMock.mockRejectedValue(new Error('Offline'));
  expect((await fetchWordFormData('ru', source)).entries).toHaveLength(ru.entries.length);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('discards a wrong-language cached copy before obtaining the correct data', async () => {
  const cache = new DeviceCache();
  cache.rows.set(wordFormDataUrl('ru'), json(uk));
  fetchMock.mockResolvedValueOnce(json(ru));
  expect((await fetchWordFormData('ru', { cacheStorage: storage(cache) })).language).toBe('ru');
  expect(cache.deleted).toEqual([wordFormDataUrl('ru')]);
  expect((await cache.rows.get(wordFormDataUrl('ru'))!.json()).language).toBe('ru');
});

it.each([
  ['HTTP failure', () => new Response('Unavailable', { status: 503 })],
  ['HTML fallback', () => new Response('<html>Sign in</html>')],
  ['another language', () => json(uk)],
  ['incomplete data', () => json({ ...ru, entries: ru.entries.slice(1) })],
] as const)('never stores %s as a dictionary and permits a later retry', async (_name, refusal) => {
  const cache = new DeviceCache(), source = { cacheStorage: storage(cache) };
  fetchMock.mockResolvedValueOnce(refusal());
  await expect(fetchWordFormData('ru', source)).rejects.toThrow();
  expect(cache.rows.size).toBe(0);
  fetchMock.mockResolvedValueOnce(json(ru));
  expect((await fetchWordFormData('ru', source)).language).toBe('ru');
});

it('still prepares the live search when optional device storage refuses', async () => {
  fetchMock.mockResolvedValueOnce(json(ru));
  const refused = { open: async () => { throw new Error('Storage refused'); } } as unknown as CacheStorage;
  expect((await fetchWordFormData('ru', { cacheStorage: refused })).language).toBe('ru');
  const cache = new DeviceCache(); cache.failPut = true;
  fetchMock.mockResolvedValueOnce(json(ru));
  expect((await fetchWordFormData('ru', { cacheStorage: storage(cache) })).language).toBe('ru');
  expect(cache.rows.size).toBe(0);
});
