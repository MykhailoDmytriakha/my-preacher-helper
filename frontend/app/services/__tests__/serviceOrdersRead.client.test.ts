import { getDocs } from 'firebase/firestore';

import { getAllServiceOrdersViaClient } from '@/services/serviceOrders.client';
import { readServiceOrdersFromServer } from '@/services/serviceOrdersReadFallback.client';

/**
 * A LIST THAT NEVER ARRIVES IS THE SAME DEFECT AS A LIST THAT ARRIVES WRONG.
 *
 * On the owner's iPad the browser's Firestore SDK returns no server answer at all — measured
 * on 2026-09-06 against the sermon page: zero server snapshots there, while the app's own HTTP
 * read answered in 205 ms from the same device. `getDocs` in that state neither resolves nor
 * throws, so a list read with a single channel and no deadline waits for ever, and the section
 * shows a skeleton under a heading.
 */

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: jest.fn(),
  getDocsFromServer: jest.fn(),
  addDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: () => ({}),
}));
jest.mock('@/services/serviceOrdersReadFallback.client', () => ({
  readServiceOrdersFromServer: jest.fn(),
}));

const rite = (id: string, title: string) => ({
  id,
  userId: 'test-user-id',
  title,
  steps: [],
  rank: 1000,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
});

const fromSdk = rite('funeral', 'Погребение');
const fromServer = rite('funeral', 'Погребение');

const snapshot = (rites: ReturnType<typeof rite>[]) => ({
  docs: rites.map((entry) => ({ id: entry.id, data: () => entry })),
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  (getDocs as jest.Mock).mockResolvedValue(snapshot([fromSdk]));
  (readServiceOrdersFromServer as jest.Mock).mockResolvedValue([fromServer]);
});

afterEach(() => jest.useRealTimers());

it('uses the browser SDK when it answers, and asks the server nothing', async () => {
  await expect(getAllServiceOrdersViaClient('test-user-id')).resolves.toEqual([fromSdk]);
  expect(readServiceOrdersFromServer).not.toHaveBeenCalled();
});

it('brings the list through the server when the SDK never answers', async () => {
  jest.useFakeTimers();
  (getDocs as jest.Mock).mockReturnValue(new Promise(() => {}));

  const list = getAllServiceOrdersViaClient('test-user-id');
  await jest.advanceTimersByTimeAsync(2500);

  await expect(list).resolves.toEqual([fromServer]);
});

it('brings the list through the server when the SDK cannot reach Firestore', async () => {
  (getDocs as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Failed to reach Firestore'), { code: 'unavailable' })
  );

  await expect(getAllServiceOrdersViaClient('test-user-id')).resolves.toEqual([fromServer]);
});

/**
 * THE SLOW ROAD IS NOT THE WRONG ROAD.
 *
 * The deadline says "do not keep him waiting", not "that answer is worthless". A merely slow
 * connection would otherwise have its own answer thrown away at 2.501 seconds and be handed a
 * failure if the second road happened to be down as well.
 */
it('still takes the SDK answer when it arrives after the deadline and the server is down', async () => {
  jest.useFakeTimers();
  let answer: ((value: unknown) => void) | undefined;
  (getDocs as jest.Mock).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  (readServiceOrdersFromServer as jest.Mock).mockRejectedValue(new Error('Server read failed'));

  const list = getAllServiceOrdersViaClient('test-user-id');
  await jest.advanceTimersByTimeAsync(2600);
  answer?.(snapshot([fromSdk]));

  await expect(list).resolves.toEqual([fromSdk]);
});

/**
 * A refusal is not a silence. Permission denied means the answer IS known — asking a second
 * channel the same question would only produce the same refusal a second later.
 */
it('does not go to the server when the SDK gave a real answer of refusal', async () => {
  (getDocs as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
  );

  await expect(getAllServiceOrdersViaClient('test-user-id')).rejects.toThrow();
  expect(readServiceOrdersFromServer).not.toHaveBeenCalled();
});

/**
 * Both channels silent is the honest failure: the caller is told, and the page says the list
 * could not be read rather than inviting the pastor to start a set he may already have.
 */
it('reports the failure when neither channel can answer', async () => {
  (getDocs as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Failed to reach Firestore'), { code: 'unavailable' })
  );
  (readServiceOrdersFromServer as jest.Mock).mockRejectedValue(new Error('Server read failed'));

  await expect(getAllServiceOrdersViaClient('test-user-id')).rejects.toThrow();
});
