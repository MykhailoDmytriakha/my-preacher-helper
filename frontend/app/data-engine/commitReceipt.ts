import { equalValues } from './protocol';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ResourceSnapshot } from './types';

/** Local capture and server acceptance are separate promises for the same immutable write. */
export interface DocumentWriteReceipt {
  requestId: string | null;
  kind: 'submitted' | 'unchanged';
  persistence: Promise<ResourceSnapshot>;
}

interface Observation {
  accept(request: CommitRequest): void;
  cancel(error: unknown): void;
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const failure = (code: string) => Object.assign(new Error(code), { code });

/** Transient observers of the canonical queue; no requests or outcomes are stored here. */
export class CommitReceipts {
  private readonly observations = new Set<Observation>();

  constructor(private readonly assertCapture: (a: CommitRequest, b: CommitRequest) => void) {}

  observe(request: CommitRequest): void {
    for (const observation of this.observations) observation.accept(request);
  }

  reset(): void {
    for (const observation of this.observations) observation.cancel(failure('owner-changed'));
  }

  async capture(owner: string, editorId: string, checkpoint: SessionCheckpoint,
    save: () => Promise<CommitRequest | null>, confirmUnchanged: () => Promise<boolean> = async () => false): Promise<{ request: CommitRequest | null; receipt: DocumentWriteReceipt }> {
    const captured = copy(checkpoint);
    let latest: CommitRequest | undefined;
    let bound: CommitRequest | undefined;
    let settled = false;
    let resolve!: (snapshot: ResourceSnapshot) => void;
    let reject!: (error: unknown) => void;
    const persistence = new Promise<ResourceSnapshot>((accept, decline) => { resolve = accept; reject = decline; });
    void persistence.catch(() => undefined);
    const finish = (snapshot?: ResourceSnapshot, error?: unknown) => {
      if (settled) return;
      settled = true;
      this.observations.delete(observation);
      if (snapshot) resolve(copy(snapshot)); else reject(error);
    };
    const settle = () => {
      if (!bound || !latest || settled) return;
      if (latest.state === 'acknowledged') {
        if (latest.result?.kind !== 'acknowledged' || latest.result.operationId !== bound.id
          || !equalValues(latest.result.snapshot.resource, bound.baseline.resource)) {
          finish(undefined, failure('acknowledgement-mismatch')); return;
        }
        finish(latest.result.snapshot);
      } else if (['conflict', 'refused', 'cancelled'].includes(latest.state)) {
        const code = latest.result?.kind === 'refused' ? latest.result.code : latest.state;
        finish(undefined, failure(code));
      }
    };
    const observation: Observation = {
      cancel: error => finish(undefined, error),
      accept: request => {
        if (settled || request.owner !== owner || request.editorId !== editorId || request.editGeneration !== captured.editGeneration) return;
        try {
          if (!equalValues(request.baseline.resource, captured.confirmed.resource)) throw failure('capture-resource-mismatch');
          if (latest) {
            if (latest.id !== request.id) throw failure('capture-identity-mismatch');
            this.assertCapture(latest, request);
            if (request.revision < latest.revision) return;
          }
          latest = copy(request);
          settle();
        } catch (error) { finish(undefined, error); }
      },
    };
    // Delivery may finish while durable capture is still returning its identity.
    this.observations.add(observation);
    try {
      const request = await save();
      if (request) {
        bound = copy(request);
        observation.accept(request);
        settle();
      } else if (!captured.dirty && Object.keys(captured.pending).length === 0 && equalValues(captured.draft, captured.confirmed.value) && await confirmUnchanged()) {
        finish(captured.confirmed);
      } else finish(undefined, failure('acceptance-unavailable'));
      return { request, receipt: { requestId: request?.id ?? null, kind: request ? 'submitted' : 'unchanged', persistence } };
    } catch (error) { finish(undefined, error); throw error; }
  }
}
