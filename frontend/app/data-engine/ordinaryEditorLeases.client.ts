'use client';

import { newClientId } from '@/utils/clientId';

export interface OrdinaryEditorLease {
  id: string;
  release(): Promise<void>;
}

export interface OrdinaryEditorLeases {
  acquire(): Promise<OrdinaryEditorLease | null>;
  runIfFree(id: string, work: () => Promise<void>): Promise<void>;
  runExclusive?<T>(scope: string, work: () => Promise<T>): Promise<T>;
}

const lockName = (id: string) => 'data-engine-ordinary-writer:' + id;

export function readOrdinaryEditorLease(value: unknown): string | null {
  return value !== null && typeof value === 'object' && 'lease' in value
    && typeof value.lease === 'string' && /^[a-z0-9-]{1,80}$/i.test(value.lease) ? value.lease : null;
}

/** A claim is published only after this browser grants the actual lock. */
export function createOrdinaryEditorLeases(locks: Pick<LockManager, 'request'> | undefined): OrdinaryEditorLeases | undefined {
  if (!locks) return undefined;
  return {
    acquire: () => {
      const id = newClientId();
      let receive!: (lease: OrdinaryEditorLease | null) => void;
      let release!: () => void;
      const acquired = new Promise<OrdinaryEditorLease | null>(resolve => { receive = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      try {
        const completed: Promise<void> = locks.request(lockName(id), { ifAvailable: true }, lock => {
          if (!lock) { receive(null); return; }
          receive({ id, release: () => { release(); return completed; } });
          return held;
        }).catch(() => { receive(null); });
      } catch { receive(null); }
      return acquired;
    },
    runExclusive: (scope, work) => locks.request('data-engine-atomic-capture:' + scope, () => work()),
    async runIfFree(id, work) {
      // Keep the same exclusive lock until the storage transaction has committed.
      let entered = false;
      try {
        await locks.request(lockName(id), { ifAvailable: true }, lock => {
          if (!lock) return;
          entered = true;
          return work();
        });
      } catch (error) {
        if (entered) throw error;
        // A browser that could not answer provides no evidence of abandonment.
      }
    },
  };
}
