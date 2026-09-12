/**
 * WRITES A WHOLE DOCUMENT A MOMENT AFTER THE LAST CHANGE, AND NEVER TWO AT ONCE.
 *
 * Typing into a section changes the council on every key; sending every key to the server is
 * churn, and sending them out of order is corruption. So each document id keeps one pending
 * copy — the latest wins — and one write in flight at a time: a change that arrives while a
 * write is out waits, coalesced, and goes as soon as the write lands. The same 700 ms the orders
 * of service settled on: long enough to swallow a burst of typing, short enough that a locked
 * phone rarely catches an unsaved word.
 *
 * Pure: no React, no storage, so the timing can be tested in a millisecond.
 */
export type WriteOptions = { keepalive?: boolean };
/**
 * Throwing is how a writer says "not stored": the copy then stays pending instead of being
 * dropped as delivered. A write that swallows its own refusal loses the change silently.
 */
export type DocWrite<T> = (id: string, doc: T, options: WriteOptions) => Promise<void>;

export class DebouncedDocWriter<T> {
  private readonly pending = new Map<string, T>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  /** How each waiting copy must travel. `keepalive` asked for once is never taken away again. */
  private readonly options = new Map<string, WriteOptions>();
  /** Documents deleted while a write of theirs was already out: their failure must not re-queue them. */
  private readonly abandoned = new Set<string>();
  /** Set once the page is going: from then on nothing waits 700 ms, because there may be no 700 ms. */
  private leaving = false;

  constructor(
    private readonly write: DocWrite<T>,
    private readonly delayMs = 700,
    private readonly onError: (id: string, error: unknown) => void = () => undefined
  ) {}

  /** Remember the latest copy and (re)start its clock. */
  schedule(id: string, doc: T): void {
    this.abandoned.delete(id);
    this.pending.set(id, doc);
    /*
     * A change made while the page is closing — the outcome panel handing over the sentence it
     * was holding, say — has no time to wait for a timer that will never fire. It goes now, and
     * it goes the way the exit does.
     */
    if (this.leaving) {
      this.options.set(id, { ...this.options.get(id), keepalive: true });
      void this.send(id, { keepalive: true });
      return;
    }
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.send(id);
      }, this.delayMs)
    );
  }

  /** Whether a copy is WAITING — not counting one already in the air. */
  hasWaiting(id: string): boolean {
    return this.pending.has(id);
  }

  /** Whether anything is still waiting to go, or on its way. */
  isPending(id?: string): boolean {
    if (id) return this.pending.has(id) || this.inFlight.has(id);
    return this.pending.size > 0 || this.inFlight.size > 0;
  }

  /**
   * Write what is pending now — all of it, or one document — and wait for it to land.
   * `keepalive` is for the way out: the browser then lets the request finish after the page is gone.
   */
  async flush(id?: string, options: WriteOptions = {}): Promise<void> {
    if (options.keepalive) this.leaving = true;
    const ids = id ? [id] : [...new Set([...this.pending.keys(), ...this.inFlight.keys()])];
    /*
     * The options belong to the COPY, not to this call. A write already in the air finishes and
     * then picks up whatever is waiting; without this the copy left behind by an exit would be
     * sent by that earlier write with ordinary settings, and the browser would be free to drop it.
     */
    ids.forEach((docId) => this.options.set(docId, { ...this.options.get(docId), ...options }));
    await Promise.all(
      ids.map(async (docId) => {
        const timer = this.timers.get(docId);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(docId);
        }
        await this.send(docId, options);
      })
    );
  }

  /**
   * REBASE WHAT IS STILL WAITING. A write lands and the document moves to a new revision; the
   * copy that was typed while it flew still carries the old one and would be refused as stale
   * against a change that is ours. The caller hands the new revision in, and the waiting copy
   * goes out built on it.
   */
  rebase(id: string, onto: (doc: T) => T): void {
    const doc = this.pending.get(id);
    if (doc !== undefined) this.pending.set(id, onto(doc));
  }

  /**
   * Forget a document's pending copy — after it was deleted, there is nothing to save. A write of
   * it may already be in the air; it cannot be recalled, but its failure must not put the copy
   * back in the queue, or a deleted council returns on the next flush.
   */
  forget(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.pending.delete(id);
    this.options.delete(id);
    if (this.inFlight.has(id)) this.abandoned.add(id);
  }

  /** Drop everything: the account changed, and none of this belongs to the new one. */
  forgetAll(): void {
    [...this.timers.keys()].forEach((id) => this.forget(id));
    this.pending.clear();
    this.options.clear();
    this.inFlight.forEach((_, id) => this.abandoned.add(id));
    this.leaving = false;
  }

  /** The page is going: from now on a change goes immediately, and the way an exit goes. */
  leaveNow(): void {
    this.leaving = true;
  }

  /** The page came back from the browser's cache: there is time again, so waiting resumes. */
  resumeAfterReturn(): void {
    this.leaving = false;
  }

  private async send(id: string, options: WriteOptions = {}): Promise<void> {
    if (options.keepalive) this.options.set(id, { ...this.options.get(id), keepalive: true });
    // A write is out: the pending copy waits and goes right after it lands.
    const current = this.inFlight.get(id);
    if (current) {
      await current;
      if (this.pending.has(id)) await this.send(id, this.options.get(id) ?? options);
      return;
    }
    const doc = this.pending.get(id);
    if (doc === undefined) return;
    this.pending.delete(id);
    const travel = { ...this.options.get(id), ...options };
    let succeeded = false;
    const flight = this.write(id, doc, travel)
      .then(() => {
        succeeded = true;
        // Only when nothing is waiting: the copy left behind inherits how this one was asked to
        // travel, and clearing that here is how an exit's `keepalive` was lost mid-hand-off.
        if (!this.pending.has(id)) this.options.delete(id);
      })
      .catch((error: unknown) => {
        // The copy that failed comes back as pending unless a newer one has replaced it — or the
        // document was deleted meanwhile, in which case there is nothing left to save.
        if (!this.pending.has(id) && !this.abandoned.has(id)) this.pending.set(id, doc);
        this.onError(id, error);
      })
      .finally(() => {
        this.inFlight.delete(id);
        this.abandoned.delete(id);
      });
    this.inFlight.set(id, flight);
    await flight;
    /*
     * Something changed while the write was out — it goes now, not on a fresh 700 ms. But NOT
     * after a failure: a refused write sent again at once is a storm, not persistence. The
     * failed copy waits for the next change or an explicit flush.
     */
    if (succeeded && this.pending.has(id) && !this.timers.has(id)) await this.send(id, this.options.get(id) ?? {});
  }
}
