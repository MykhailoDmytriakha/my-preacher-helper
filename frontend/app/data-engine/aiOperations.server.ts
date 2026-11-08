import 'server-only';

import { aiResultReceipt as open, reconcileReadyAiResultReceipts as reconcile } from '@/services/aiResultReceipt.server';

import { createAiPromptTelemetryRecord, createAiResultReceiptStore, updateAiPromptTelemetryOutcome } from './server';

import type { ReceiptInput } from '@/services/aiResultReceipt.server';

/** Server workflows receive domain outcomes, never database clients or transaction handles. */
export function aiResultReceipt(input: ReceiptInput) {
  return open(input, createAiResultReceiptStore(input.ownerId));
}

export function reconcileReadyAiResultReceipts(ownerId: string, now: Date): Promise<void> {
  return reconcile(createAiResultReceiptStore(ownerId), now);
}

export function createAiPromptTelemetry(eventId: string, fields: object, terminal?: boolean): Promise<void> {
  return createAiPromptTelemetryRecord(eventId, fields, terminal);
}

export function settleAiPromptTelemetry(eventId: string, fields: object): Promise<void> {
  return updateAiPromptTelemetryOutcome(eventId, fields);
}
