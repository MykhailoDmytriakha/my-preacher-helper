import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

import { isWordFormData, WORD_FORMS_CACHE, wordFormDataUrl, type WordFormData, type WordFormLanguage } from './wordFormAssets';

type Sources = { cacheStorage?: CacheStorage; timeoutMs?: number };
const deviceCache = (): CacheStorage | undefined => typeof caches === 'undefined' ? undefined : caches;

async function openCache(storage: CacheStorage | undefined): Promise<Cache | undefined> {
  try { return await storage?.open(WORD_FORMS_CACHE); } catch { return undefined; }
}

/** An optional device copy may refuse; that does not prevent a live search. */
async function keptResponse(cache: Cache | undefined, url: string): Promise<Response | undefined> {
  try { return await cache?.match(url); } catch { return undefined; }
}

async function read(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

/** Read for an actual search or the background Bible preparation. The device copy needs no controlling worker. */
export async function fetchWordFormData(language: WordFormLanguage,
  { cacheStorage = deviceCache(), timeoutMs = 10000 }: Sources = {}): Promise<WordFormData> {
  const url = wordFormDataUrl(language), cache = await openCache(cacheStorage);
  const kept = await keptResponse(cache, url);
  if (kept) {
    const value = await read(kept);
    if (isWordFormData(value, language)) return value;
    try { await cache?.delete(url); } catch { /* The invalid copy is still never used. */ }
  }
  const response = await fetchWithTimeout(url, { timeout: timeoutMs });
  if (!response.ok) throw new Error(`Word forms for ${language}: HTTP ${response.status}`);
  const value: unknown = await response.clone().json();
  if (!isWordFormData(value, language)) throw new Error(`Word forms for ${language}: invalid language payload`);
  try { await cache?.put(url, response); } catch { /* A refused cache keeps this search usable, but cannot promise an offline copy. */ }
  return value;
}

/** Keep the search prerequisite with offline reading, without constructing a lexicon or reparsing retained data. */
export async function warmWordFormData(language: WordFormLanguage,
  { cacheStorage = deviceCache(), ...sources }: Sources = {}): Promise<{ onDevice: boolean; storageFailed: boolean }> {
  const cache = await openCache(cacheStorage), url = wordFormDataUrl(language);
  if (!cache) return { onDevice: false, storageFailed: true };
  if (await keptResponse(cache, url)) return { onDevice: true, storageFailed: false };
  try {
    await fetchWordFormData(language, { ...sources, cacheStorage });
  } catch {
    // A network or payload refusal leaves the books readable; the next warm-up can try again.
    return { onDevice: false, storageFailed: false };
  }
  // The live loader tolerates a refused write. Warming must not mistake that for a retained offline copy.
  const onDevice = Boolean(await keptResponse(cache, url));
  return { onDevice, storageFailed: !onDevice };
}
