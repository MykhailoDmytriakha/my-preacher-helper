'use client';

import { recordDiagnostic, setEditQueueReader } from '@/utils/appDiagnostics';

import type { JournalEntry } from './types';

interface PendingSource {
  getPending(): JournalEntry[];
  subscribePending(listener: () => void): () => void;
}

/** States worth a line in the path; `sending` follows every edit and only fills the log. */
const REPORTED = new Set<JournalEntry['state']>(['unknown', 'conflict', 'refused', 'blocked']);
/** The engine shows queued → acknowledged → gone: only the acknowledgement proves delivery. */
const SETTLED = new Set<JournalEntry['state']>(['acknowledged', 'refused', 'conflict']);

/**
 * WHAT THE PERSON DID, AS THE QUEUE SAW IT (owner, 2026-10-10: a report must let us reproduce a bug).
 * Each edit leaves a short trail in the diagnostics — queued, then delivered or what stopped it — with
 * its collection and the time it took, never its document or its words. The report also reads the
 * queue as it stands at the moment it is taken.
 */
export function watchEditQueue(engine: PendingSource, ownerOf: () => string | null = () => null): () => void {
  const collection = (entry: JournalEntry) => entry.command.resource.collection;
  const age = (entry: JournalEntry) => Math.max(0, Date.now() - entry.createdAt);
  let previous = new Map(engine.getPending().map(entry => [entry.command.operationId, entry]));
  let previousOwner = ownerOf();

  const stopListening = engine.subscribePending(() => {
    const next = new Map(engine.getPending().map(entry => [entry.command.operationId, entry]));
    const owner = ownerOf();
    if (owner !== previousOwner) {
      // Another account, or none: the old owner's queue left the view, it was not delivered.
      previous = next;
      previousOwner = owner;
      return;
    }
    for (const [id, entry] of next) {
      const before = previous.get(id);
      if (!before) recordDiagnostic('edit', { collection: collection(entry), result: 'queued' });
      if (before?.state === entry.state) continue;
      if (entry.state === 'acknowledged') recordDiagnostic('edit', { collection: collection(entry), result: 'delivered', elapsedMs: age(entry) });
      else if (REPORTED.has(entry.state)) recordDiagnostic('edit', { collection: collection(entry), result: entry.state, elapsedMs: age(entry) });
    }
    for (const [id, entry] of previous) {
      if (next.has(id) || SETTLED.has(entry.state)) continue;
      // Gone without an outcome seen here — cancelled or finished by another tab: say only that it left.
      recordDiagnostic('edit', { collection: collection(entry), result: 'left', elapsedMs: age(entry) });
    }
    previous = next;
  });

  const reader = () => engine.getPending().map(entry => ({ collection: collection(entry), state: entry.state, createdAt: entry.createdAt }));
  setEditQueueReader(reader);
  return () => {
    stopListening();
    setEditQueueReader(null);
  };
}
