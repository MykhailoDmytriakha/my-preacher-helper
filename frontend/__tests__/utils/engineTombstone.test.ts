import { shapeCouncils } from '@/services/councils.client';
import { isEngineTombstone } from '@/utils/engineTombstone';

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn() }));

describe('isEngineTombstone', () => {
  it('recognises only a marker that says deleted', () => {
    expect(isEngineTombstone({ userId: 'u', _dataEngine: { protocol: 1, generation: 'g', revision: 2, deleted: true } })).toBe(true);
    expect(isEngineTombstone({ userId: 'u', _dataEngine: { protocol: 1, generation: 'g', revision: 1, deleted: false } })).toBe(false);
    expect(isEngineTombstone({ userId: 'u', title: 'Legacy council' })).toBe(false);
    expect(isEngineTombstone({ _dataEngine: null })).toBe(false);
    expect(isEngineTombstone(null)).toBe(false);
  });

  it('keeps a tombstone out of the council list both roads share', () => {
    const councils = shapeCouncils([
      { id: 'alive', userId: 'u', title: 'Совет', status: 'preparing', topics: [] },
      { id: 'buried', userId: 'u', _dataEngine: { protocol: 1, generation: 'g', revision: 2, deleted: true } },
    ]);
    expect(councils.map(council => council.id)).toEqual(['alive']);
  });
});
