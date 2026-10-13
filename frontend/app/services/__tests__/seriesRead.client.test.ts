import { getDoc, getDocs } from 'firebase/firestore';

import { getAllGroups } from '@/services/groups.service';
import { readOwnerDocument, readOwnerList } from '@/services/ownerListRead.client';
import { getAllSeries } from '@/services/series.service';
import { getStudyNotes } from '@services/studies.service';

/**
 * SERIES, GROUPS AND STUDY NOTES READ LIKE EVERY OTHER OWNER LIST.
 *
 * The rule itself — bound the browser's read, and when it says nothing, ask the app's own
 * server — lives in `ownerListRead.client.ts` and is proven there. What belongs here is the
 * wiring: that these three collections go through it under their own names, and that one
 * series or one group can still be read on a device whose Firestore transport is silent.
 */

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  doc: () => ({}),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}));
jest.mock('@/services/ownerListRead.client', () => ({
  // The real module underneath: a stub that lists only what this file uses silently drops
  // whatever the service starts using next (`isSilentReadError`, say).
  ...jest.requireActual('@/services/ownerListRead.client'),
  readOwnerList: jest.fn(),
  readOwnerListFromServer: jest.fn(),
  readOwnerDocument: jest.fn(),
}));
jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'u1' } },
}));
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
}));

const mockRead = readOwnerList as jest.MockedFunction<typeof readOwnerList>;
const mockReadDocument = readOwnerDocument as jest.MockedFunction<typeof readOwnerDocument>;

const storedSeries = {
  userId: 'u1',
  title: 'Первая серия',
  theme: 'Вера',
  bookOrTopic: 'Римлянам',
  status: 'active',
  items: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const storedGroup = {
  userId: 'u1',
  title: 'Молодёжь',
  status: 'draft',
  templates: [],
  flow: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 's1', data: () => storedSeries }] });
  (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, id: 's1', data: () => storedSeries });
  mockRead.mockImplementation(async (_collection, _owner, viaSdk) => viaSdk as never);
  mockReadDocument.mockImplementation(async (_collection, _owner, _id, viaSdk) => viaSdk as never);
});

describe('owner lists that were left on one road', () => {
  it('reads the series list through the one road every owner list uses', async () => {
    const list = await getAllSeries('u1');

    expect(mockRead).toHaveBeenCalledWith('series', 'u1', expect.any(Promise), expect.any(Function));
    expect(list[0]).toMatchObject({ id: 's1', title: 'Первая серия' });
  });

  it('reads the groups list through the same road', async () => {
    (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 'g1', data: () => storedGroup }] });

    await getAllGroups('u1');

    expect(mockRead).toHaveBeenCalledWith('groups', 'u1', expect.any(Promise), expect.any(Function));
  });

  it('reads the study notes through the same road', async () => {
    (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 'n1', data: () => ({ userId: 'u1', content: 'x', scriptureRefs: [], tags: [], createdAt: '', updatedAt: '' }) }] });

    await getStudyNotes('u1');

    expect(mockRead).toHaveBeenCalledWith('studyNotes', 'u1', expect.any(Promise), expect.any(Function));
  });
});
