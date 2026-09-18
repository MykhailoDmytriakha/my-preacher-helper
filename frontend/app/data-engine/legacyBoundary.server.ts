import { NextResponse } from 'next/server';

import type { DocumentData, DocumentReference, DocumentSnapshot, QuerySnapshot, Transaction } from 'firebase-admin/firestore';

export const DATA_ENGINE_REQUIRED = 'data-engine-required';
/**
 * THE STATUS A REFUSAL SPEAKS IN — chosen for the bundles we can no longer change.
 *
 * It used to be 409. But in the councils and service-order clients already shipped to users,
 * 409 means "compare-and-set conflict, and the body IS the current document"
 * (councilsTransport.client.ts: `conflict: status === 409, current: value`): an old PWA that
 * met this refusal forgot the person's waiting text and cached the refusal body as a council
 * (BUG-20260918-legacy-refusal-409-reads-as-conflict). Any status outside that client's table
 * lands in its `refused` branch, which keeps the text and says the save failed. 426 Upgrade
 * Required is that, and it is also true: the way out is the newer bundle.
 * The body's `code` stays the contract for bundles that know it — they match it at any status.
 */
export const LEGACY_REFUSAL_STATUS = 426;
const MAX_LEGACY_WRITES = 100;

export function assertLegacyWritable(raw: DocumentData | undefined): void {
  if (raw && Object.prototype.hasOwnProperty.call(raw, '_dataEngine')) {
    throw Object.assign(new Error(DATA_ENGINE_REQUIRED), { code: DATA_ENGINE_REQUIRED, status: LEGACY_REFUSAL_STATUS });
  }
}

export function isDataEngineRequired(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === DATA_ENGINE_REQUIRED);
}

export function legacyBoundaryResponse(error: unknown): NextResponse | null {
  return isDataEngineRequired(error) ? NextResponse.json({ code: DATA_ENGINE_REQUIRED, error: DATA_ENGINE_REQUIRED }, { status: LEGACY_REFUSAL_STATUS }) : null;
}

/** Only reviewed legacy APIs may use this bridge. It cannot mutate protocol documents.
 * Every target is read in this transaction, so migration racing a legacy write retries
 * against the marker. Query reads register each document before any cascade is written. */
export async function runLegacyTransaction<T>(body: (transaction: Transaction) => Promise<T>): Promise<T> {
  const { adminDb } = await import('@/config/firebaseAdminConfig');
  return adminDb.runTransaction(async transaction => {
    const key = (reference: DocumentReference) => reference.path ?? reference;
    const read = new Map<string | DocumentReference, DocumentData | undefined>();
    const written = new Set<string | DocumentReference>();
    const remember = (value: DocumentSnapshot | QuerySnapshot | DocumentSnapshot[], target: DocumentReference) => {
      const snapshots = Array.isArray(value) ? value : 'docs' in value ? value.docs : [value];
      for (const snapshot of snapshots) read.set(key(snapshot.ref ?? target), snapshot.exists === false ? undefined : snapshot.data());
    };
    const wrapped = new Proxy(transaction, {
      get(target, property) {
        const method = Reflect.get(target, property);
        if (typeof method !== 'function') return method;
        if (property === 'get' || property === 'getAll') return async (...args: unknown[]) => {
          if (written.size) throw new Error('Legacy transaction reads must precede writes');
          const result = await Reflect.apply(method, target, args);
          remember(result as DocumentSnapshot | QuerySnapshot, args[0] as DocumentReference);
          return result;
        };
        if (['set', 'update', 'create', 'delete'].includes(String(property))) return (...args: unknown[]) => {
          const reference = args[0] as DocumentReference;
          if (!read.has(key(reference))) throw new Error('Legacy mutation requires a transactional target read');
          assertLegacyWritable(read.get(key(reference)));
          const patch = args[1];
          if (patch && typeof patch === 'object' && Object.keys(patch).some(key => key === '_dataEngine' || key.startsWith('_dataEngine.'))) {
            assertLegacyWritable({ _dataEngine: true });
          }
          if (typeof patch === 'string' && (patch === '_dataEngine' || patch.startsWith('_dataEngine.'))) assertLegacyWritable({ _dataEngine: true });
          if (property !== 'delete' && (!patch || typeof patch !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(patch)))) throw new Error('Legacy bridge requires an object patch');
          written.add(key(reference));
          if (written.size > MAX_LEGACY_WRITES) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: DATA_ENGINE_REQUIRED, status: LEGACY_REFUSAL_STATUS });
          Reflect.apply(method, target, args);
          return wrapped;
        };
        return method.bind(target);
      },
    });
    return body(wrapped);
  });
}

export async function updateLegacyDocument(reference: DocumentReference, patch: DocumentData): Promise<void> {
  await runLegacyTransaction(async transaction => {
    await transaction.get(reference);
    transaction.update(reference, patch);
  });
}

export async function deleteLegacyDocument(reference: DocumentReference): Promise<void> {
  await runLegacyTransaction(async transaction => {
    await transaction.get(reference);
    transaction.delete(reference);
  });
}

/** Returns the existing legacy value for the old client-ID replay contract. */
export async function createLegacyDocument(reference: DocumentReference, data: DocumentData, owner: string): Promise<{ created: boolean; data: DocumentData }> {
  return runLegacyTransaction(async transaction => {
    const current = await transaction.get(reference);
    const existing = current.exists ? current.data() : undefined;
    if (current.exists) {
      if (existing?.userId !== owner) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied', status: 403 });
      assertLegacyWritable(existing);
      return { created: false, data: existing! };
    }
    transaction.create(reference, data);
    return { created: true, data };
  });
}
