import type { ResourceRef } from './types';

export interface LocalWriteAddress {
  owner: string;
  kind: 'checkpoint' | 'manual' | 'membership';
  id: string;
  resource?: ResourceRef;
}

/** A retired stage carries only its original device-write capability, never a command. */
export interface LocalWriteHandoff {
  address: LocalWriteAddress;
  persist(): Promise<void>;
}

/** Finish the admitted queue before repairing its last local copy. UI authority ends separately. */
export function retireLocalWrite(address: LocalWriteAddress, pending: Promise<unknown>, close: () => void,
  durable: () => boolean, persist: () => Promise<void>, finishPending = false): LocalWriteHandoff {
  if (!finishPending) close();
  return { address, persist: async () => {
    await pending.catch(() => undefined);
    close();
    if (!durable()) await persist();
  } };
}

interface Attempt<T = unknown> {
  address: LocalWriteAddress;
  key: string;
  operation: () => Promise<T>;
  running: Promise<T> | null;
}

/** Device persistence outlives the editor that admitted it; no transport, clock or document merge. */
export class LocalWriteback {
  private readonly pending = new Map<string, Attempt>();
  private readonly tails = new Map<string, Promise<unknown>>();

  write<T>(address: LocalWriteAddress, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([address.owner, address.kind, address.id]);
    const attempt: Attempt<T> = { address: { ...address, ...(address.resource ? { resource: { ...address.resource } } : {}) }, key, operation, running: null };
    this.pending.set(key, attempt);
    return this.start(attempt);
  }

  retry(owner: string, matches: (address: LocalWriteAddress) => boolean = () => true): Promise<void> | undefined {
    const attempts = [...this.pending].filter(([, attempt]) => attempt.address.owner === owner && matches(attempt.address));
    // An empty handoff set must not delay ordinary engine work by an extra microtask.
    if (!attempts.length) return undefined;
    return (async () => {
      for (const [key, attempt] of attempts) if (this.pending.get(key) === attempt) await this.start(attempt);
    })();
  }

  private start<T>(attempt: Attempt<T>): Promise<T> {
    if (attempt.running) return attempt.running;
    const preceding = this.tails.get(attempt.key) ?? Promise.resolve();
    const running = preceding.catch(() => undefined).then(attempt.operation);
    attempt.running = running;
    this.tails.set(attempt.key, running);
    const finish = (succeeded: boolean) => {
      if (attempt.running === running) attempt.running = null;
      if (this.tails.get(attempt.key) === running) this.tails.delete(attempt.key);
      if (succeeded && this.pending.get(attempt.key) === attempt) this.pending.delete(attempt.key);
    };
    void running.then(() => finish(true), () => finish(false));
    return running;
  }
}
