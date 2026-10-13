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
});
