import { getDocs } from 'firebase/firestore';

import { readOwnerList, readOwnerListFromServer } from '@/services/ownerListRead.client';
import {
  getAllServiceOrdersFromServerViaClient,
  getAllServiceOrdersViaClient,
} from '@/services/serviceOrders.client';

/**
 * THE RITES READ LIKE EVERY OTHER OWNER LIST, and are proven to.
 *
 * The rule itself — bound the browser's read, and when it says nothing, ask the app's own server
 * — lives in `ownerListRead.client.ts` and is proven there. What belongs here is the wiring: that
 * this collection goes through that rule, under its own name, and that both roads shape the
 * documents the same way.
 *
 * Separately: the question "is this rite really gone?" is NOT that read. It refuses to be
 * answered from the local replica, because silence from a cache cannot be told from silence from
 * the server, and a page must not announce a deletion nobody performed.
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
jest.mock('@/services/ownerListRead.client', () => ({
  readOwnerList: jest.fn(),
  readOwnerListFromServer: jest.fn(),
}));

const mockRead = readOwnerList as jest.MockedFunction<typeof readOwnerList>;
const mockServerRead = readOwnerListFromServer as jest.MockedFunction<typeof readOwnerListFromServer>;

const stored = {
  userId: 'test-user-id',
  title: 'Погребение',
  steps: [{ id: 's1', title: 'Перед началом', scriptureRefs: [] }],
  rank: 1000,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 'funeral', data: () => stored }] });
});

it('reads the rites through the one road every owner list uses', async () => {
  mockRead.mockResolvedValue([]);

  await getAllServiceOrdersViaClient('test-user-id');

  expect(mockRead).toHaveBeenCalledWith(
    'serviceOrders',
    'test-user-id',
    expect.any(Promise),
    expect.any(Function)
  );
});

it('shapes what the server sends exactly as it shapes what the browser read', async () => {
  let shapeFromServer: ((documents: Record<string, unknown>[]) => unknown[]) | undefined;
  mockRead.mockImplementation(async (_collection, _owner, viaSdk, hydrate) => {
    shapeFromServer = hydrate as (documents: Record<string, unknown>[]) => unknown[];
    return viaSdk;
  });

  const viaBrowser = await getAllServiceOrdersViaClient('test-user-id');
  const viaServer = shapeFromServer?.([{ ...stored, id: 'funeral' }]);

  expect(viaServer).toEqual(viaBrowser);
});

/**
 * A rite absent from a CACHED answer proves nothing; only the server can say it is gone. And on
 * the device this whole change is for, the only road that answers at all is the HTTPS one.
 */
it('asks the server itself when the question is whether a rite still exists', async () => {
  mockServerRead.mockResolvedValue([]);

  await getAllServiceOrdersFromServerViaClient('test-user-id');

  expect(mockServerRead).toHaveBeenCalledWith(
    'serviceOrders',
    'test-user-id',
    expect.any(Function)
  );
  expect(getDocs).not.toHaveBeenCalled();
});
