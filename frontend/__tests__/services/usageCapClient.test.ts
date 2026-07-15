import {
  notifyUsageCapReached,
  notifyUsageRequestSettled,
  subscribeToUsageClientEvents,
  throwIfUsageCapReached,
} from '@/services/usageCapClient';
import { UsageCapReachedError } from '@/services/usageLimits';

describe('usageCapClient', () => {
  it('turns the machine envelope into a typed error and publishes it once', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToUsageClientEvents(listener);
    const response = new Response(JSON.stringify({
      code: 'USAGE_CAP_REACHED',
      resource: 'ai',
      used: 110,
      baseLimit: 100,
      hardCap: 110,
      resetsAt: '2026-08-01T00:00:00.000Z',
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });

    await expect(throwIfUsageCapReached(response)).rejects.toBeInstanceOf(UsageCapReachedError);
    const error = listener.mock.calls[0][0].error as UsageCapReachedError;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: 'cap-reached', error });
    expect(notifyUsageCapReached(error)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('ignores ordinary error responses and publishes request settlement separately', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToUsageClientEvents(listener);

    await expect(throwIfUsageCapReached(new Response('no', { status: 500 }))).resolves.toBeUndefined();
    expect(notifyUsageCapReached(new Error('ordinary'))).toBe(false);
    notifyUsageRequestSettled();
    expect(listener).toHaveBeenCalledWith({ type: 'request-settled' });

    unsubscribe();
  });
});
