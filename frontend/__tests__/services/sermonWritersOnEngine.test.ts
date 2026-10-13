import { updateDoc } from 'firebase/firestore';

import { createSermon, deleteSermon } from '@/services/sermon.service';
import { savePlanModeViaClient, updateThoughtViaClient } from '@/services/sermons.client';

jest.mock('firebase/firestore', () => ({ ...jest.requireActual('firebase/firestore'), updateDoc: jest.fn(), runTransaction: jest.fn(), doc: jest.fn(() => ({})) }));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn(() => ({})) }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';

describe('legacy sermon writers once the engine owns sermons', () => {
  afterEach(() => { delete process.env[ON_ENGINE]; });

  it.each([
    ['plan mode', () => savePlanModeViaClient('s1', 'manual')],
    ['a thought', () => updateThoughtViaClient('s1', { id: 't', text: 'x', tags: [], date: 'd' }, null)],
    ['creation', () => createSermon({ title: 'T', verse: 'V', date: 'd', thoughts: [], userId: 'u' })],
    ['deletion', () => deleteSermon('s1')],
  ])('refuses %s with the typed engine error and writes nothing', async (_name, write) => {
    process.env[ON_ENGINE] = 'sermons';
    await expect(write()).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    expect(updateDoc).not.toHaveBeenCalled();
  });

});
