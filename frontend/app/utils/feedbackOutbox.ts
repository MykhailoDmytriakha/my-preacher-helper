import { del, entries } from 'idb-keyval';

import { prepareFeedbackPayload, submitFeedback } from '@/services/feedback.service';
import { newClientId } from '@/utils/clientId';
import { reconnectingStore } from '@/utils/deviceStorage';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { serverInReach } from '@/utils/reachableAgain';
import { updateStoredValue } from '@/utils/storageUpdate';

/**
 * A FEEDBACK IS SENT BY PRESSING «SEND», NOT BY WAITING FOR THE SERVER (owner, 2026-11-17: «после нажатия
 * на кнопку отправить — чуть-чуть анимации и сразу окно закрылось, а всё остальное уже делается в
 * background … даже если это офлайн, оно ждёт интернета, и когда интернет пришёл — отправилось»).
 *
 * Send first writes the feedback to this device, then the window closes; delivery happens from here as
 * soon as the server is in reach — at once, after a reload, or when the network returns
 * (`components/FeedbackDelivery`). Each feedback carries its own id, so a send repeated after a lost
 * answer is stored and emailed once (`api/feedback`, `doc(id).create`).
 *
 * This is a one-way message to the developer, not the person's data: nothing else writes it and nothing
 * merges with it, so it needs no engine document — only a place to wait and a name.
 */
export interface QueuedFeedback {
  id: string;
  ownerId: string;
  feedbackText: string;
  feedbackType: string;
  images: string[];
  diagnostics?: Record<string, unknown>;
  queuedAt: number;
  /** A refusal with a known waiting time (429): not asked again before this moment. */
  notBefore?: number;
}

export type FeedbackDelivery =
  | { kind: 'delivered' }
  /** Not yet: no connection, the server busy or asking to wait. The feedback stays queued. */
  | { kind: 'waiting' }
  /** The server will never take it as it is; it left the queue, and `error` says why. */
  | { kind: 'refused'; error: unknown };

/** The device could not keep the feedback; the caller sends it directly instead. */
export class FeedbackNotKeptError extends Error {
  constructor(cause: unknown) {
    super('The feedback could not be kept on this device', { cause });
    this.name = 'FeedbackNotKeptError';
  }
}

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

const refusalListeners = new Set<(error: unknown) => void>();

/** Told of every feedback the server refused for good after its window closed; returns the unsubscribe. */
export function onFeedbackRefused(listener: (error: unknown) => void): () => void {
  refusalListeners.add(listener);
  return () => { refusalListeners.delete(listener); };
}

/** Says a refusal nobody else will: the form is closed, the words left the queue. */
export function announceFeedbackRefused(error: unknown): void {
  refusalListeners.forEach(listener => listener(error));
}

let store: ReturnType<typeof reconnectingStore> | null = null;
const getStore = () => {
  if (typeof indexedDB === 'undefined') return null;
  store ??= reconnectingStore('feedback-outbox', 'feedback-outbox');
  return store;
};

/**
 * Keeps the feedback on this device for delivery. A feedback the server would refuse for its size is
 * refused here, before anything is kept; a device that cannot keep it throws `FeedbackNotKeptError`.
 */
export async function queueFeedback(input: Omit<QueuedFeedback, 'id' | 'queuedAt' | 'notBefore'> & { id?: string }): Promise<QueuedFeedback> {
  // The caller's name keeps a feedback the same across presses of the same words (`useFeedback`).
  const entry: QueuedFeedback = { ...input, id: input.id ?? newClientId(), queuedAt: Date.now() };
  prepareFeedbackPayload({ ...entry, userId: entry.ownerId, feedbackId: entry.id });
  const current = getStore();
  if (!current) throw new FeedbackNotKeptError(new Error('Device storage is unavailable'));
  try {
    await updateStoredValue<QueuedFeedback>(entry.id, () => entry, current);
  } catch (cause) {
    throw new FeedbackNotKeptError(cause);
  }
  return entry;
}

/** The status of a failed send, when the server answered at all. */
const answeredStatus = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/** One attempt per feedback at a time: the send right after «Send» and the background loop share it. */
const attempts = new Map<string, Promise<FeedbackDelivery>>();

/** Sends one queued feedback once, unless an attempt for it is already on its way. */
export function deliverFeedback(entry: QueuedFeedback): Promise<FeedbackDelivery> {
  const running = attempts.get(entry.id);
  if (running) return running;
  const attempt = attemptDelivery(entry).finally(() => { attempts.delete(entry.id); });
  attempts.set(entry.id, attempt);
  return attempt;
}

async function attemptDelivery(entry: QueuedFeedback): Promise<FeedbackDelivery> {
  const current = getStore();
  if (!current || !serverInReach()) return { kind: 'waiting' };
  // Sent only while its writer is signed in: the request carries the signed-in account's token, and
  // after a switch of account it would carry someone else's (Codex review 2026-11-17).
  if (resolveOwnerUid() !== entry.ownerId) return { kind: 'waiting' };
  try {
    await submitFeedback(entry.feedbackText, entry.feedbackType, entry.images, entry.ownerId, entry.diagnostics, entry.id);
  } catch (error) {
    const status = answeredStatus(error);
    if (status === 429) {
      const seconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      const waitMs = typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_WAIT_MS;
      await updateStoredValue<QueuedFeedback>(entry.id, stored => ({ ...(stored ?? entry), notBefore: Date.now() + waitMs }), current)
        .catch(() => undefined);
      return { kind: 'waiting' };
    }
    // No answer, a busy server or a letter not sent yet, an expired sign-in, a timed-out request, or
    // an account the server says did not write it (409): the same feedback can still be taken later.
    // Any other answer refuses this feedback as it is, now and every time after.
    if (status === undefined || status === 401 || status === 408 || status === 409 || status >= 500) return { kind: 'waiting' };
    await del(entry.id, current).catch(() => undefined);
    return { kind: 'refused', error };
  }
  await del(entry.id, current).catch(() => undefined);
  return { kind: 'delivered' };
}

let loop: Promise<void> | null = null;

/**
 * Delivers this account's queued feedback, oldest first, while the server is in reach. Feedback that
 * the server refused for good leaves the queue and is announced (`onFeedbackRefused`).
 */
export function deliverQueuedFeedback(ownerId: string): Promise<void> {
  if (loop) return loop;
  loop = (async () => {
    const current = getStore();
    if (!current || !serverInReach()) return;
    const queued = (await entries<string, QueuedFeedback>(current)).map(([, entry]) => entry)
      .filter(entry => entry && entry.ownerId === ownerId)
      .sort((left, right) => left.queuedAt - right.queuedAt);
    for (const entry of queued) {
      if (entry.notBefore && entry.notBefore > Date.now()) continue;
      const outcome = await deliverFeedback(entry);
      if (outcome.kind === 'refused') announceFeedbackRefused(outcome.error);
      // Without a connection the rest waits too; a «not yet» the server answered for one feedback
      // (its letter, its account, its rate) does not hold back the next one.
      if (outcome.kind === 'waiting' && !serverInReach()) return;
    }
  })().finally(() => { loop = null; });
  return loop;
}
