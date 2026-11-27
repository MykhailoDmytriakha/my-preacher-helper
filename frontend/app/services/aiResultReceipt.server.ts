import { createHash } from 'node:crypto';

import { AiResultPendingError, AiResultReceiptConflict } from '@/api/errors/aiResultRecovery.server';
import { resolveFirestoreWriteRefusal } from '@/api/errors/firestoreWriteRefusal.server';
import { usageAfterConsumption } from '@/services/usageLimits.server';
import { getUsagePeriodStart } from '@/services/userEntitlement.server';
import { AI_RESULT_RUNNING_WINDOW_MS } from '@/utils/aiResultOperation';
import { serializeContent } from '@/utils/contentFingerprint';

import type { UserEntitlement } from '@/models/models';
import type { PlanResultOrigin } from '@/utils/planResultOrigin';

const RECONCILE_BATCH = 16;
const AI_RESULT_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

type State = 'running' | 'ready' | 'settled' | 'failed';

export interface ReceiptRecord {
  fingerprint: string;
  startedAtMs: number;
  state: State;
  plan?: PlanResultOrigin;
  planInboxKey?: string | null;
  result?: {
    json: string;
    completedAtMs: number;
  };
}

interface PendingReceipt {
  id: string;
  record: ReceiptRecord;
}

interface ReceiptTransaction {
  read(id: string): Promise<ReceiptRecord | undefined>;
  readReady(limit: number): Promise<PendingReceipt[]>;
  readUsage(): Promise<UserEntitlement['usage']>;
  writeUsage(usage: NonNullable<UserEntitlement['usage']>): void;
  writeReceipt(id: string, patch: Partial<ReceiptRecord> & { chargePeriod?: string; settledAtMs?: number }): void;
}

export interface AiResultReceiptStore {
  read(id: string): Promise<ReceiptRecord | undefined>;
  create(id: string, record: ReceiptRecord): Promise<(patch: Partial<ReceiptRecord>) => Promise<void>>;
  transaction<T>(run: (transaction: ReceiptTransaction) => Promise<T>): Promise<T>;
  listPlan(prefix: string, limit: number, after?: string): Promise<PendingReceipt[]>;
}

async function settleReceipts(
  transaction: ReceiptTransaction,
  pending: PendingReceipt[],
  settledAt: Date,
) {
  const period = getUsagePeriodStart(settledAt);
  const receipts = pending.map(({ id, record }) => {
    if (record.state !== 'ready' || !record.result) throw new Error('The AI operation has no result to settle');
    return { id, chargePeriod: getUsagePeriodStart(new Date(record.startedAtMs)) };
  });
  const aiUsed = receipts.filter(receipt => receipt.chargePeriod === period).length;
  if (aiUsed > 0) {
    const usage = await transaction.readUsage();
    transaction.writeUsage(usageAfterConsumption(usage, { aiUsed }, settledAt));
  }
  // Older receipts settle into their original period without spending the new allowance.
  for (const { id, chargePeriod } of receipts) {
    transaction.writeReceipt(id, { state: 'settled', chargePeriod, settledAtMs: settledAt.getTime() });
  }
}

/** Only manual paid text admission calls this. Polls and ordinary entitlement reads stay read-only. */
export async function reconcileReadyAiResultReceipts(store: AiResultReceiptStore, now: Date): Promise<void> {
  const count = await store.transaction(async transaction => {
    const pending = await transaction.readReady(RECONCILE_BATCH);
    await settleReceipts(transaction, pending, now);
    return pending.length;
  });
  // Do not admit new paid work against a counter that may still be missing an older result.
  // The next explicit action can drain another bounded batch.
  if (count === RECONCILE_BATCH) throw new AiResultPendingError();
}

interface NewClaim {
  state: 'claimed';
  save: (result: unknown) => Promise<void>;
  fail: () => Promise<void>;
}

interface ExistingClaim {
  state: State;
  startedAtMs: number;
}

export interface ReceiptInput {
  ownerId: string;
  operationId: string;
  fingerprint: string;
  now?: () => Date;
  plan?: PlanResultOrigin;
}

type PlanScope = Pick<PlanResultOrigin, 'sermonId' | 'mode'>;
const INBOX_PAGE_SIZE = 10;

function planScopeKey({ sermonId, mode }: PlanScope): string {
  return createHash('sha256').update(serializeContent([sermonId, mode])).digest('hex') + ':';
}

function inboxKey(plan: PlanScope, startedAtMs: number, operationId: string): string {
  return planScopeKey(plan) + String(startedAtMs).padStart(16, '0') + ':' + operationId;
}

function inPlan(record: ReceiptRecord | undefined, scope: PlanScope): record is ReceiptRecord & { plan: PlanResultOrigin } {
  return record?.plan?.sermonId === scope.sermonId && record.plan.mode === scope.mode;
}

export async function listPlanReceipts(store: AiResultReceiptStore, scope: PlanScope, now: Date,
  cursor?: string, known: string[] = []) {
  const prefix = planScopeKey(scope);
  if (cursor && (!cursor.startsWith(prefix) || !/^\d{16}:[a-z0-9][a-z0-9_-]{0,99}$/i.test(cursor.slice(prefix.length)))) {
    throw new AiResultReceiptConflict();
  }
  const page = await store.listPlan(prefix, INBOX_PAGE_SIZE + 1, cursor);
  const shown = page.slice(0, INBOX_PAGE_SIZE);
  const visible = new Set(shown.map(item => item.id));
  const closed = await readClosedPlanReceipts(store, scope, known.filter(id => !visible.has(id)));
  return {
    items: shown.filter(({ record }) => inPlan(record, scope)
      && (record.state === 'ready' || record.state === 'settled'
        || record.state === 'running' && record.startedAtMs > now.getTime() - AI_RESULT_RUNNING_WINDOW_MS)),
    closed,
    next: page.length > INBOX_PAGE_SIZE ? shown.at(-1)?.record.planInboxKey ?? undefined : undefined,
  };
}

export async function readClosedPlanReceipts(store: AiResultReceiptStore, scope: PlanScope, known: string[]) {
  if (known.length > 16 || known.some(id => !AI_RESULT_OPERATION_ID.test(id))) throw new AiResultReceiptConflict();
  const checks = await Promise.all([...new Set(known)].map(async id => {
    const record = await store.read(id);
    return inPlan(record, scope) && record.state === 'settled' && record.planInboxKey === null ? id : undefined;
  }));
  return checks.filter(id => id !== undefined);
}

export function closePlanReceipt(store: AiResultReceiptStore, scope: PlanScope, id: string) {
  if (!AI_RESULT_OPERATION_ID.test(id)) throw new AiResultReceiptConflict();
  return store.transaction(async transaction => {
    const record = await transaction.read(id);
    if (!record || !inPlan(record, scope) || record.state !== 'settled') return false;
    // A fulfilled decision hides the offer while preserving the receipt and its accounting.
    if (record.planInboxKey) transaction.writeReceipt(id, { planInboxKey: null });
    return true;
  });
}

export async function settlePlanReceipt(store: AiResultReceiptStore, input: {
  ownerId: string; scope: PlanScope; id: string; now: Date;
}) {
  if (!AI_RESULT_OPERATION_ID.test(input.id)) throw new AiResultReceiptConflict();
  const record = await store.read(input.id);
  if (!record || !inPlan(record, input.scope) || !record.planInboxKey || record.state === 'failed') return undefined;
  if (record.state === 'running') throw new AiResultPendingError();
  return aiResultReceipt({ ownerId: input.ownerId, operationId: input.id, fingerprint: record.fingerprint, now: () => input.now }, store).settle();
}

/**
 * The generation owns a create-only claim. It can publish one result without
 * waiting for the user counter. Settlement then updates the receipt and the
 * counter atomically, and callers only get the result after that commit.
 */
export function aiResultReceipt(
  { operationId, fingerprint, now = () => new Date(), plan }: ReceiptInput,
  store: AiResultReceiptStore,
) {
  if (!AI_RESULT_OPERATION_ID.test(operationId)) throw new AiResultReceiptConflict();

  function assertBinding(record: ReceiptRecord | undefined): asserts record is ReceiptRecord {
    if (record?.fingerprint !== fingerprint) throw new AiResultReceiptConflict();
  }

  async function read(): Promise<ExistingClaim | undefined> {
    const record = await store.read(operationId);
    if (!record) return undefined;
    assertBinding(record);
    return { state: record.state, startedAtMs: record.startedAtMs };
  }

  return {
    read,
    async claim(): Promise<NewClaim | ExistingClaim> {
      let publish: (patch: Partial<ReceiptRecord>) => Promise<void>;
      try {
        const startedAtMs = now().getTime();
        publish = await store.create(operationId, {
          fingerprint, startedAtMs, state: 'running',
          ...(plan && { plan, planInboxKey: inboxKey(plan, startedAtMs, operationId) }),
        });
      } catch (error) {
        if (resolveFirestoreWriteRefusal(error)?.code !== 'already-exists') throw error;
        const existing = await read();
        if (!existing) throw new AiResultPendingError();
        return existing;
      }

      // The generation cannot overwrite a ready/settled receipt even if its
      // first publication committed and only the acknowledgment was lost.
      return {
        state: 'claimed',
        async save(value) {
          const json = JSON.stringify(value);
          if (json === undefined) throw new Error('Cannot record an empty AI result');
          await publish({ state: 'ready', result: { json, completedAtMs: now().getTime() } });
        },
        async fail() {
          await publish({ state: 'failed', ...(plan && { planInboxKey: null }) });
        },
      };
    },

    async expireRunning(cutoffMs: number): Promise<ExistingClaim> {
      return store.transaction(async transaction => {
        const record = await transaction.read(operationId);
        assertBinding(record);
        if (record.state === 'running' && record.startedAtMs <= cutoffMs) {
          // Closing the claim changes its write time, fencing out a late publisher.
          transaction.writeReceipt(operationId, { state: 'failed', ...(record.plan && { planInboxKey: null }) });
          return { state: 'failed', startedAtMs: record.startedAtMs };
        }
        return { state: record.state, startedAtMs: record.startedAtMs };
      });
    },

    async settle(): Promise<{ value: unknown; completedAtMs: number }> {
      const result = await store.transaction(async transaction => {
        const record = await transaction.read(operationId);
        assertBinding(record);
        if (!record.result || (record.state !== 'ready' && record.state !== 'settled')) {
          throw new Error('The AI operation has no result to settle');
        }
        if (record.state === 'settled') return record.result;

        await settleReceipts(transaction, [{ id: operationId, record }], now());
        return record.result;
      });

      return { value: JSON.parse(result.json) as unknown, completedAtMs: result.completedAtMs };
    },
  };
}
