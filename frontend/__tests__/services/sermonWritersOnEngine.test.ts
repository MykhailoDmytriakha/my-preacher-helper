import { updateDoc } from 'firebase/firestore';

import { createSermon, deleteSermon } from '@/services/sermon.service';
import { addPreachDate } from '@/services/preachDates.service';
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
    ['a preach date', () => addPreachDate('s1', { date: '2026-09-23', church: { id: 'c', name: 'C' } } as never)],
  ])('refuses %s with the typed engine error and writes nothing', async (_name, write) => {
    process.env[ON_ENGINE] = 'sermons';
    await expect(write()).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('leaves the legacy road open while sermons are not on the engine', async () => {
    process.env[ON_ENGINE] = 'councils';
    const outcome = await savePlanModeViaClient('s1', 'manual').then(() => 'written', (error: { code?: string }) => error?.code ?? 'other');
    expect(outcome).not.toBe('data-engine-required');
  });
});
