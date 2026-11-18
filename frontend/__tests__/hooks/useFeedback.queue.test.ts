import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';

import { useFeedback } from '@/hooks/useFeedback';
import { submitFeedback } from '@services/feedback.service';
import { serverInReach } from '@/utils/reachableAgain';
import { onFeedbackRefused } from '@/utils/feedbackOutbox';

/*
 * The owner's suggestion of 2026-11-17: «после нажатия на кнопку отправить — чуть-чуть анимации и сразу
 * окно закрылось … даже если это офлайн». The window closes after a short moment whatever the network
 * does; an answer that comes within that moment is still said in the form.
 */

const mockRows = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (key: string) => mockRows.get(key)),
  del: jest.fn(async (key: string) => { mockRows.delete(key); }),
  entries: jest.fn(async () => Array.from(mockRows.entries())),
  update: jest.fn(async (key: string, change: (old: unknown) => unknown) => { mockRows.set(key, change(mockRows.get(key))); }),
}));
jest.mock('@services/feedback.service', () => ({
  ...jest.requireActual('@services/feedback.service'),
  submitFeedback: jest.fn(),
}));
jest.mock('@/utils/reachableAgain', () => ({ serverInReach: jest.fn(() => true) }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'alice' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const send = jest.mocked(submitFeedback);
const inReach = jest.mocked(serverInReach);

async function press(result: { current: ReturnType<typeof useFeedback> }, ms: number) {
  let settled = false;
  let value: boolean | void = undefined;
  let failure: unknown;
  await act(async () => {
    result.current.handleSubmitFeedback('Words', 'bug', [], 'alice').then(answer => { settled = true; value = answer; }, error => { settled = true; failure = error; });
    await jest.advanceTimersByTimeAsync(ms);
  });
  return { settled: () => settled, value: () => value, failure: () => failure };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRows.clear();
  send.mockReset().mockResolvedValue({ success: true });
  inReach.mockReset().mockReturnValue(true);
  jest.mocked(toast.success).mockClear();
  jest.mocked(toast.error).mockClear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});
afterEach(() => { jest.useRealTimers(); });

it('closes with thanks after a short moment while offline, keeping the feedback to send later', async () => {
  inReach.mockReturnValue(false);
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  const sent = await press(result, 500);
  expect(sent.value()).toBe(true);
  expect(result.current.showFeedbackModal).toBe(false);
  expect(toast.success).toHaveBeenCalledWith('feedback.successMessage');
  expect(send).not.toHaveBeenCalled();
  expect(mockRows.size).toBe(1);
});

it('does not hold the window open for a slow server: delivery goes on behind it', async () => {
  send.mockImplementation(() => new Promise(() => undefined));
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  const sent = await press(result, 1_000);
  expect(sent.settled()).toBe(false);
  await act(async () => { await jest.advanceTimersByTimeAsync(600); });
  expect(sent.value()).toBe(true);
  expect(result.current.showFeedbackModal).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  expect(mockRows.size).toBe(1);
});

it('sends at once when online, under the feedback’s own name, and lets the kept copy go', async () => {
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  const sent = await press(result, 500);
  expect(sent.value()).toBe(true);
  const id = send.mock.calls[0][5];
  expect(typeof id).toBe('string');
  expect(mockRows.size).toBe(0);
});

it('keeps a refusal that came in time in the open form, with the words', async () => {
  send.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, code: 'permission-denied' }));
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  const sent = await press(result, 1_000);
  expect(sent.failure()).toMatchObject({ code: 'permission-denied' });
  expect(result.current.showFeedbackModal).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  expect(mockRows.size).toBe(0);
});

// Codex review 2026-11-17: the window closed with thanks, and a refusal that came two seconds later was
// dropped with the words — no message at all.
it('says a refusal that comes after the window closed', async () => {
  let refuse!: () => void;
  send.mockImplementation(() => new Promise((_resolve, reject) => {
    refuse = () => reject(Object.assign(new Error('Forbidden'), { status: 403, code: 'permission-denied' }));
  }));
  const heard = jest.fn();
  const stop = onFeedbackRefused(heard);
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  const sent = await press(result, 1_600);
  expect(sent.value()).toBe(true);
  await act(async () => { refuse(); await jest.advanceTimersByTimeAsync(0); });
  stop();
  expect(heard).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission-denied' }));
});

// Codex review round 3, 2026-11-17: the device could not keep the first press, could keep the second;
// the second got a new name and the server mailed the same words twice.
it('keeps the name of unchanged words when the device can keep them on the second press', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  send.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const { result } = renderHook(() => useFeedback());
  act(() => { result.current.handleFeedbackClick(); });
  await press(result, 2_000);
  const firstName = send.mock.calls[0][5];
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
  await press(result, 2_000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][5]).toBe(firstName);
});
