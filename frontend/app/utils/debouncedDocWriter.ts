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
export type DocWrite<T> = (id: string, doc: T) => Promise<void>;

export class DebouncedDocWriter<T> {
  private readonly pending = new Map<string, T>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly write: DocWrite<T>,
    private readonly delayMs = 700,
    private readonly onError: (id: string, error: unknown) => void = () => undefined
  ) {}

  /** Remember the latest copy and (re)start its clock. */
  schedule(id: string, doc: T): void {
    this.pending.set(id, doc);
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

  /** Whether anything is still waiting to go, or on its way. */
  isPending(id?: string): boolean {
    if (id) return this.pending.has(id) || this.inFlight.has(id);
    return this.pending.size > 0 || this.inFlight.size > 0;
  }

  /** Write what is pending now — all of it, or one document — and wait for it to land. */
  async flush(id?: string): Promise<void> {
    const ids = id ? [id] : [...new Set([...this.pending.keys(), ...this.inFlight.keys()])];
    await Promise.all(
      ids.map(async (docId) => {
        const timer = this.timers.get(docId);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(docId);
        }
        await this.send(docId);
      })
    );
  }

  /** Forget a document's pending copy — after it was deleted, there is nothing to save. */
  forget(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.pending.delete(id);
  }

  private async send(id: string): Promise<void> {
    // A write is out: the pending copy waits and goes right after it lands.
    const current = this.inFlight.get(id);
    if (current) {
      await current;
      if (this.pending.has(id)) await this.send(id);
      return;
    }
    const doc = this.pending.get(id);
    if (doc === undefined) return;
    this.pending.delete(id);
    let succeeded = false;
    const flight = this.write(id, doc)
      .then(() => {
        succeeded = true;
      })
      .catch((error: unknown) => {
        // The copy that failed comes back as pending unless a newer one has replaced it.
        if (!this.pending.has(id)) this.pending.set(id, doc);
        this.onError(id, error);
      })
      .finally(() => {
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, flight);
    await flight;
    /*
     * Something changed while the write was out — it goes now, not on a fresh 700 ms. But NOT
     * after a failure: a refused write sent again at once is a storm, not persistence. The
     * failed copy waits for the next change or an explicit flush.
     */
    if (succeeded && this.pending.has(id) && !this.timers.has(id)) await this.send(id);
  }
}
