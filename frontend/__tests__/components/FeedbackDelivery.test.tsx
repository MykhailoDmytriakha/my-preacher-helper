import { act, render } from '@testing-library/react';
import { toast } from 'sonner';

import { FeedbackDelivery } from '@/components/FeedbackDelivery';
import { deliverQueuedFeedback } from '@/utils/feedbackOutbox';
import { subscribeToReachableAgain } from '@/utils/reachableAgain';
import { holdQuietScreen } from '@/utils/quietScreen';

/* A feedback kept on the device leaves without the form: on every private page, at start and whenever
   the server comes back into reach (owner, 2026-11-17). */

let mockUser: { uid: string } | null = { uid: 'alice' };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
const mockRefusalListeners = new Set<(error: unknown) => void>();
jest.mock('@/utils/feedbackOutbox', () => ({
  deliverQueuedFeedback: jest.fn(async () => undefined),
  onFeedbackRefused: (listener: (error: unknown) => void) => { mockRefusalListeners.add(listener); return () => { mockRefusalListeners.delete(listener); }; },
}));
const refuse = () => { mockRefusalListeners.forEach(listener => listener(new Error('refused'))); };
const mockReturns: (() => void)[] = [];
jest.mock('@/utils/reachableAgain', () => ({
  subscribeToReachableAgain: jest.fn((listener: () => void) => { mockReturns.push(listener); return () => undefined; }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const deliver = jest.mocked(deliverQueuedFeedback);

beforeEach(() => { jest.useFakeTimers(); deliver.mockClear(); mockReturns.length = 0; mockUser = { uid: 'alice' }; });
afterEach(() => { jest.useRealTimers(); });

it('delivers at start, when the server is back in reach, and again after a while', () => {
  render(<FeedbackDelivery />);
  expect(deliver).toHaveBeenCalledWith('alice');
  act(() => { mockReturns[0](); });
  expect(deliver).toHaveBeenCalledTimes(2);
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(deliver).toHaveBeenCalledTimes(3);
  expect(subscribeToReachableAgain).toHaveBeenCalled();
});

it('says a feedback the server refused for good', () => {
  render(<FeedbackDelivery />);
  act(() => { refuse(); });
  expect(toast.error).toHaveBeenCalledWith('feedback.deliveryRefused');
});

// Codex review 2026-11-17: a refusal heard while a sermon is preached popped a toast over it.
it('waits with the message while a sermon is preached and says it once preaching ends', () => {
  jest.mocked(toast.error).mockClear();
  let release: () => void = () => undefined;
  act(() => { release = holdQuietScreen(); });
  render(<FeedbackDelivery />);
  act(() => { refuse(); refuse(); });
  expect(toast.error).not.toHaveBeenCalled();
  act(() => { release(); });
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('feedback.deliveryRefused');
});

it('delivers nothing without a signed-in person', () => {
  mockUser = null;
  render(<FeedbackDelivery />);
  expect(deliver).not.toHaveBeenCalled();
});
