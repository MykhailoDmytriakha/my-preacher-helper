import { deliverFeedback, deliverQueuedFeedback, onFeedbackRefused, queueFeedback } from '@/utils/feedbackOutbox';
import { submitFeedback } from '@/services/feedback.service';
import { serverInReach } from '@/utils/reachableAgain';
import { MAX_FEEDBACK_TEXT_BYTES } from '@/utils/feedbackPayload';

/*
 * The owner's suggestion of 2026-11-17: pressing «Send» closes the feedback window at once; the feedback
 * waits on the device and leaves when the server is in reach, offline included — once, and not lost on
 * the way.
 */

const mockRows = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (key: string) => mockRows.get(key)),
  del: jest.fn(async (key: string) => { mockRows.delete(key); }),
  entries: jest.fn(async () => Array.from(mockRows.entries())),
  update: jest.fn(async (key: string, change: (old: unknown) => unknown) => { mockRows.set(key, change(mockRows.get(key))); }),
}));
jest.mock('@/services/feedback.service', () => ({
  ...jest.requireActual('@/services/feedback.service'),
  submitFeedback: jest.fn(),
}));
jest.mock('@/utils/reachableAgain', () => ({ serverInReach: jest.fn(() => true) }));
let mockSignedIn: string | undefined = 'alice';
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => mockSignedIn }));

const send = jest.mocked(submitFeedback);
const inReach = jest.mocked(serverInReach);
const answered = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
const queued = () => Array.from(mockRows.values()) as { id: string; feedbackText: string; notBefore?: number }[];
const words = (text: string, ownerId = 'alice') => ({ ownerId, feedbackText: text, feedbackType: 'bug', images: [] });

beforeEach(() => {
  mockRows.clear();
  send.mockReset().mockResolvedValue({ success: true });
  inReach.mockReset().mockReturnValue(true);
  mockSignedIn = 'alice';
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});

it('keeps a feedback written offline and sends it once, under its own name, when the server is back', async () => {
  inReach.mockReturnValue(false);
  const entry = await queueFeedback(words('Written in church without a network'));
  await deliverQueuedFeedback('alice');
  expect(send).not.toHaveBeenCalled();
  expect(queued()).toHaveLength(1);

  inReach.mockReturnValue(true);
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('Written in church without a network', 'bug', [], 'alice', undefined, entry.id);
  expect(queued()).toEqual([]);
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(1);
});

it('sends the oldest first and only the signed-in account’s feedback', async () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(3_000);
  await queueFeedback(words('first'));
  await queueFeedback(words('someone else', 'bob'));
  await queueFeedback(words('second'));
  jest.restoreAllMocks();
  await deliverQueuedFeedback('alice');
  expect(send.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
  expect(queued().map(entry => entry.feedbackText)).toEqual(['someone else']);
});

it.each([
  ['no answer', Object.assign(new TypeError('Failed to fetch'))],
  ['a busy server', answered(503)],
  ['an expired sign-in', answered(401)],
])('keeps the feedback after %s and tries again later', async (_name, failure) => {
  send.mockRejectedValueOnce(failure);
  await queueFeedback(words('Keep me'));
  await deliverQueuedFeedback('alice');
  expect(queued()).toHaveLength(1);
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(2);
  expect(queued()).toEqual([]);
});

it('waits as long as the server asked when too many feedbacks came at once', async () => {
  send.mockRejectedValueOnce(answered(429, { retryAfterSeconds: 120 }));
  await queueFeedback(words('Later, please'));
  await deliverQueuedFeedback('alice');
  expect(queued()[0].notBefore).toBeGreaterThan(Date.now() + 119_000);
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(1);
});

it('says a feedback the server will never take and lets it go', async () => {
  const refusal = answered(403, { code: 'permission-denied' });
  send.mockRejectedValueOnce(refusal);
  const onRefused = jest.fn();
  const stop = onFeedbackRefused(onRefused);
  await queueFeedback(words('Refused'));
  await deliverQueuedFeedback('alice');
  stop();
  expect(onRefused).toHaveBeenCalledWith(refusal);
  expect(queued()).toEqual([]);
});

// Codex review 2026-11-17: Alice's queue went on draining after Bob signed in on the same device, and
// the server took her words as his.
it('sends nothing of one account while another is signed in, and sends it once the writer is back', async () => {
  await queueFeedback(words('Alice wrote this'));
  mockSignedIn = 'bob';
  await deliverQueuedFeedback('alice');
  expect(send).not.toHaveBeenCalled();
  expect(queued()).toHaveLength(1);
  mockSignedIn = 'alice';
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(1);
  expect(queued()).toEqual([]);
});

it('keeps a feedback the server says another account wrote, and keeps the one whose letter is still pending', async () => {
  send.mockRejectedValueOnce(answered(409, { code: 'owner-mismatch' })).mockRejectedValueOnce(answered(503, { code: 'email-pending' }));
  await queueFeedback(words('Mine'));
  await deliverQueuedFeedback('alice');
  await deliverQueuedFeedback('alice');
  expect(queued()).toHaveLength(1);
});

it('sends a feedback once even when the form and the background ask for it together', async () => {
  let answer!: () => void;
  send.mockImplementationOnce(() => new Promise(resolve => { answer = () => resolve({ success: true }); }));
  const entry = await queueFeedback(words('Once'));
  const fromForm = deliverFeedback(entry);
  const fromBackground = deliverQueuedFeedback('alice');
  await Promise.resolve();
  answer();
  await expect(fromForm).resolves.toEqual({ kind: 'delivered' });
  await fromBackground;
  expect(send).toHaveBeenCalledTimes(1);
});

it('refuses a feedback too large for the server before keeping anything', async () => {
  await expect(queueFeedback(words('x'.repeat(MAX_FEEDBACK_TEXT_BYTES + 1)))).rejects.toThrow('Feedback text is too large');
  expect(queued()).toEqual([]);
});

// Codex review round 2, 2026-11-17: one feedback whose letter keeps failing held back every later one.
it('goes on to the next feedback when the server answered «not yet» for one, and stops only without a connection', async () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
  await queueFeedback(words('first, letter pending'));
  await queueFeedback(words('second'));
  jest.restoreAllMocks();
  send.mockRejectedValueOnce(answered(503, { code: 'email-pending' }));
  await deliverQueuedFeedback('alice');
  expect(send.mock.calls.map(call => call[0])).toEqual(['first, letter pending', 'second']);
  expect(queued().map(entry => entry.feedbackText)).toEqual(['first, letter pending']);
  send.mockClear();
  send.mockImplementationOnce(async () => { inReach.mockReturnValue(false); throw new TypeError('Failed to fetch'); });
  await queueFeedback(words('third'));
  await deliverQueuedFeedback('alice');
  expect(send).toHaveBeenCalledTimes(1);
});
