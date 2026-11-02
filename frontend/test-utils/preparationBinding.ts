import type { PreparationTextBinding } from '@/components/common/manualTextBinding';

/** A presentation fixture; engine persistence and ancestry are tested with the real facade. */
export function preparationBinding(value: string, subject = 'preparation-fixture'): PreparationTextBinding {
  return { subject, value, ready: true, active: true, busy: false, dirty: false, error: null,
    begin: jest.fn(async () => undefined), update: jest.fn(async () => undefined), save: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined), retry: jest.fn(async () => undefined),
    recovery: { choices: [], loading: false, error: null, recover: jest.fn(async () => undefined), refresh: jest.fn(async () => undefined), discard: jest.fn(async (action: () => Promise<void>) => action()) } };
}
