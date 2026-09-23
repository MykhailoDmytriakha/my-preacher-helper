import { setDoc, updateDoc } from 'firebase/firestore';

import { createStudyNote, deleteStudyNote, updateStudyNote } from '@/services/studies.service';

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  setDoc: jest.fn(), updateDoc: jest.fn(), addDoc: jest.fn(), getDoc: jest.fn(), doc: jest.fn(() => ({})), collection: jest.fn(() => ({})),
}));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn(() => ({})) }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: jest.fn(async () => ({})) }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';

describe('legacy study-note writers once the engine owns notes', () => {
  const fetchSpy = jest.fn();
  beforeAll(() => { global.fetch = fetchSpy as never; });
  afterEach(() => { delete process.env[ON_ENGINE]; jest.clearAllMocks(); });

  it.each([
    ['creation', () => createStudyNote({ id: 'n1', userId: 'u', content: 'x', tags: [], scriptureRefs: [], type: 'note' })],
    ['an edit', () => updateStudyNote('n1', { content: 'y', userId: 'u' }, 1, { content: 'x' })],
    ['deletion', () => deleteStudyNote('n1', 'u')],
  ])('refuses %s with the typed engine error and writes nothing', async (_name, write) => {
    process.env[ON_ENGINE] = 'studyNotes';
    await expect(write()).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
