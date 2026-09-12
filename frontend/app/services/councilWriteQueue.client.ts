'use client';

import { DebouncedDocWriter } from '@/utils/debouncedDocWriter';

import type { Council } from '@/models/models';
import type { CouncilSaveResult } from '@/services/councils.service';

/**
 * ONE QUEUE PER ACCOUNT, NOT PER SCREEN.
 *
 * The hub, the list, the breadcrumbs and the council itself all hold the councils hook, and each
 * of them used to build its own writer and its own notion of what was still unsaved. They shared
 * one cache but not that knowledge, so a background read started by the breadcrumbs could not
 * tell that the council screen had a write in the air, and installed its older copy over it —
 * the class of defect where nothing errors and a sentence simply disappears.
 *
 * The queue therefore lives beside the cache, not inside a component: module scope, keyed by the
 * account. Every screen that mounts the hook talks to the same one and sees the same answer to
 * "is this council settled?".
 */
export type CouncilQueue = {
  /** Whose councils these are. The writer outlives screens, so it must never serve another account. */
  readonly userId: string;
  writer: DebouncedDocWriter<Council>;
  /** Councils whose latest state the server has not confirmed: typed, refused, or newly created. */
  unsettled: Set<string>;
  /**
   * Councils the server has answered about. Only for these does "not found" mean "deleted";
   * for the rest it means a create made on this device has not arrived yet.
   */
  knownToServer: Set<string>;
  /**
   * The highest revision the server has confirmed for each council. A read that started before a
   * write and lands after it carries a lower one; that answer is old news, not a correction, and
   * this is how it is told apart — by a counter the server owns, never by a clock.
   */
  confirmedRev: Map<string, number>;
  /**
   * When each council was last confirmed, counted in writes rather than seconds. A read knows the
   * count it set out with; an answer that cannot have seen a confirmation is recognised by it
   * being older than that number — no clocks involved.
   */
  confirmedAt: Map<string, number>;
  /** How many confirmations this session has seen. Only ever goes up. */
  confirmations: number;
  /** What the last write of each council came back as — the carry-over needs a real answer, not a guess. */
  lastResult: Map<string, CouncilSaveResult>;
  /** What the mounted screen wants done with a write's outcome. Replaced as screens come and go. */
  settle: (id: string, result: CouncilSaveResult) => void;
};

const queues = new Map<string, CouncilQueue>();

/**
 * Look one up without creating or disturbing anything. A write that lands after its account has
 * been left must find nothing and stop — asking the creating function for it would sweep away
 * the queue of the account that is signed in NOW, taking its unsaved work with it.
 */
export function existingCouncilQueue(userId: string): CouncilQueue | undefined {
  return queues.get(userId);
}

/** Drop an account's queue — on the way out, so nothing of theirs waits behind a signed-out session. */
export function dropCouncilQueue(userId: string): void {
  const queue = queues.get(userId);
  if (!queue) return;
  queue.writer.forgetAll();
  queues.delete(userId);
}

export function councilQueue(userId: string, createWriter: () => DebouncedDocWriter<Council>): CouncilQueue {
  const existing = queues.get(userId);
  if (existing) return existing;
  /*
   * A NEW ACCOUNT MEANS THE OLD ONE IS DONE. One browser, one person signed in at a time: keeping
   * the previous account's queue alive would let a write of theirs finish into this account's
   * cache, and would hold their councils in memory for the rest of the page's life.
   */
  queues.forEach((queue, id) => {
    if (id === userId) return;
    queue.writer.forgetAll();
    queues.delete(id);
  });
  const queue: CouncilQueue = {
    userId,
    writer: createWriter(),
    unsettled: new Set(),
    knownToServer: new Set(),
    confirmedRev: new Map(),
    confirmedAt: new Map(),
    confirmations: 0,
    lastResult: new Map(),
    settle: () => undefined,
  };
  queues.set(userId, queue);
  return queue;
}

/** For tests: forget every account's queue. */
export function resetCouncilQueues(): void {
  queues.clear();
}
