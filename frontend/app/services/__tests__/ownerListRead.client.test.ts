import { apiClient } from '@/utils/apiClient';
import { readOwnerList } from '@/services/ownerListRead.client';

/**
 * A LIST THAT NEVER ARRIVES IS THE SAME DEFECT AS A LIST THAT ARRIVES WRONG.
 *
 * On the owner's iPad the browser's Firestore SDK returns no server answer at all — measured
 * 2026-09-06 against the sermon page: zero server snapshots there, while the app's own HTTP read
 * answered in 205 ms from the same device. `getDocs` in that state neither resolves nor throws,
 * so a list read with a single road and no deadline waits for ever and the screen shows a
 * skeleton under its heading.
 *
 * This is the one place that rule lives, so this is the one place it is proven.
 */

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer token' }),
}));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'owner-1' }));
jest.mock('@/utils/appDiagnostics', () => ({
  recordDiagnostic: jest.fn(),
  diagnosticErrorCode: () => undefined,
}));

const mockApi = apiClient as jest.MockedFunction<typeof apiClient>;

const shape = (documents: Record<string, unknown>[]) =>
  documents.map((entry) => ({ id: String(entry.id), title: String(entry.title) }));

const fromServer = [{ id: 'a', title: 'От сервера' }];
const fromSdk = [{ id: 'a', title: 'От браузера' }];

const silent = () => new Promise<never>(() => {});
const unavailable = () =>
  Promise.reject(Object.assign(new Error('Failed to reach Firestore'), { code: 'unavailable' }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  mockApi.mockResolvedValue({ ok: true, status: 200, json: async () => fromServer } as Response);
});

afterEach(() => jest.useRealTimers());

it('uses the browser SDK when it answers, and asks the server nothing', async () => {
  await expect(readOwnerList('sermons', 'owner-1', Promise.resolve(fromSdk), shape)).resolves.toEqual(fromSdk);
  expect(mockApi).not.toHaveBeenCalled();
});

it('brings the list through the server when the SDK never answers', async () => {
  jest.useFakeTimers();

  const list = readOwnerList('sermons', 'owner-1', silent(), shape);
  await jest.advanceTimersByTimeAsync(2500);

  await expect(list).resolves.toEqual(fromServer);
  expect(mockApi).toHaveBeenCalledWith(
    expect.stringContaining('collection=sermons'),
    expect.anything()
  );
});

it('brings the list through the server when the SDK cannot reach Firestore', async () => {
  await expect(readOwnerList('prayerRequests', 'owner-1', unavailable(), shape)).resolves.toEqual(fromServer);
});

/**
 * THE SLOW ROAD IS NOT THE WRONG ROAD. The deadline says "do not keep him waiting", not "that
 * answer is worthless": a merely slow connection would otherwise have its own answer thrown away
 * at 2.501 seconds and be handed a failure if the second road happened to be down as well.
 */
it('still takes the SDK answer when it arrives late and the server is down', async () => {
  jest.useFakeTimers();
  mockApi.mockRejectedValue(new Error('Server read failed'));
  let answer: ((value: typeof fromSdk) => void) | undefined;
  const late = new Promise<typeof fromSdk>((resolve) => { answer = resolve; });

  const list = readOwnerList('sermons', 'owner-1', late, shape);
  await jest.advanceTimersByTimeAsync(2600);
  answer?.(fromSdk);

  await expect(list).resolves.toEqual(fromSdk);
});

/**
 * A refusal is not a silence. Permission denied means the answer IS known — asking a second road
 * the same question would only produce the same refusal a second later.
 */
it('does not go to the server when the SDK gave a real answer of refusal', async () => {
  const refused = Promise.reject(
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
  );

  await expect(readOwnerList('sermons', 'owner-1', refused, shape)).rejects.toThrow();
  expect(mockApi).not.toHaveBeenCalled();
});

/** Offline the local replica is the only truthful answer, and the server is unreachable anyway. */
it('does not go to the server while offline', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

  await expect(readOwnerList('sermons', 'owner-1', unavailable(), shape)).rejects.toThrow();
  expect(mockApi).not.toHaveBeenCalled();
});

it('reports the failure when neither road can answer', async () => {
  mockApi.mockRejectedValue(new Error('Server read failed'));

  await expect(readOwnerList('sermons', 'owner-1', unavailable(), shape)).rejects.toThrow();
});

/**
 * THE PAIR ITSELF IS BOUND. The silent road can stay silent for ever; if the second road then
 * fails, waiting on the two of them would be the very defect this helper exists to end.
 */
it('gives up on both roads rather than waiting for ever', async () => {
  jest.useFakeTimers();
  mockApi.mockRejectedValue(new Error('Server read failed'));

  const list = readOwnerList('sermons', 'owner-1', silent(), shape);
  const settled = expect(list).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(12000);

  await settled;
});

/**
 * WHOSE LIST WAS ASKED FOR IS DECIDED BY WHO ASKED. A sign-in inside those 2.5 seconds would
 * otherwise fetch the NEW account's documents and hand them back to a request made for the old
 * one — into a cache still keyed by the old owner.
 */
it('refuses to answer a request made for someone who is no longer signed in', async () => {
  jest.useFakeTimers();

  const list = readOwnerList('sermons', 'someone-else', silent(), shape);
  const settled = expect(list).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(2500);

  await settled;
  expect(mockApi).not.toHaveBeenCalled();
});

/** An answer that is not a list is not an answer: it must not reach a screen as one. */
it('refuses a malformed server answer', async () => {
  mockApi.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

  await expect(readOwnerList('sermons', 'owner-1', unavailable(), shape)).rejects.toThrow();
});
