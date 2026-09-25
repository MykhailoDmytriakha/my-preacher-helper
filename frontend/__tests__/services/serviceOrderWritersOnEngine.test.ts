import * as editing from '@/services/serviceOrderEditing.client';
import * as sdk from '@/services/serviceOrders.client';
import {
  createServiceOrder,
  deleteServiceOrder,
  setServiceOrderRank,
  setServiceOrderRanks,
  updateServiceOrderMeta,
  updateServiceOrderSteps,
} from '@/services/serviceOrders.service';
import { seedServiceOrdersOnServer } from '@/services/serviceOrdersSeed.client';

jest.mock('@/services/serviceOrderEditing.client', () => ({
  createServiceOrderOnServer: jest.fn(), deleteServiceOrderOnServer: jest.fn(), setServiceOrderRanksOnServer: jest.fn(),
  updateServiceOrderMetaOnServer: jest.fn(), updateServiceOrderStepsOnServer: jest.fn(),
}));
jest.mock('@/services/serviceOrders.client', () => ({
  ...jest.requireActual('@/services/serviceOrders.client'),
  createServiceOrderViaClient: jest.fn(), deleteServiceOrderViaClient: jest.fn(), setServiceOrderRankViaClient: jest.fn(),
  setServiceOrderRanksViaClient: jest.fn(), updateServiceOrderMetaViaClient: jest.fn(), updateServiceOrderStepsViaClient: jest.fn(),
}));
jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
const order = { userId: 'u', title: 'Funeral', steps: [], rank: 1000, createdAt: 'c', updatedAt: 'u' };

describe('legacy service-order writers once the engine owns the collection', () => {
  afterEach(() => { delete process.env[ON_ENGINE]; jest.clearAllMocks(); });

  it.each([
    ['creation', () => createServiceOrder(order)],
    ['deletion', () => deleteServiceOrder('o1')],
    ['one rank', () => setServiceOrderRank('o1', 2000)],
    ['a spread of ranks', () => setServiceOrderRanks([{ id: 'o1', rank: 1000 }, { id: 'o2', rank: 2000 }])],
    ['a rename', () => updateServiceOrderMeta('o1', { title: 'Burial' })],
    ['the steps', () => updateServiceOrderSteps('o1', steps => steps)],
    ['seeding', () => seedServiceOrdersOnServer([{ ...order, catalogKey: 'funeral' }])],
  ])('refuses %s with the typed engine error and reaches neither road', async (_name, write) => {
    process.env[ON_ENGINE] = 'serviceOrders';
    await expect(write()).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    [...Object.values(editing), ...Object.values(sdk)].filter(jest.isMockFunction)
      .forEach(writer => expect(writer).not.toHaveBeenCalled());
  });

  it('leaves the legacy road open while service orders are not on the engine', async () => {
    process.env[ON_ENGINE] = 'councils';
    jest.mocked(editing.deleteServiceOrderOnServer).mockResolvedValue(undefined);
    await expect(deleteServiceOrder('o1')).resolves.toBeUndefined();
    expect(editing.deleteServiceOrderOnServer).toHaveBeenCalledWith('o1');
  });
});
