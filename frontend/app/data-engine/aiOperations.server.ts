import 'server-only';

import { aiResultReceipt as open, closePlanReceipt, listPlanReceipts, readClosedPlanReceipts, reconcileReadyAiResultReceipts as reconcile, settlePlanReceipt } from '@/services/aiResultReceipt.server';

import { createAiPromptTelemetryRecord, createAiResultReceiptStore, updateAiPromptTelemetryOutcome } from './server';

import type { ReceiptInput } from '@/services/aiResultReceipt.server';
import type { PlanResultMode } from '@/utils/planResultOrigin';

/** Server workflows receive domain outcomes, never database clients or transaction handles. */
export function aiResultReceipt(input: ReceiptInput) {
  return open(input, createAiResultReceiptStore(input.ownerId));
}

export function reconcileReadyAiResultReceipts(ownerId: string, now: Date): Promise<void> {
  return reconcile(createAiResultReceiptStore(ownerId), now);
}

export function listPlanAiResults(ownerId: string, sermonId: string, mode: PlanResultMode, cursor?: string, known?: string[]) {
  return listPlanReceipts(createAiResultReceiptStore(ownerId), { sermonId, mode }, new Date(), cursor, known);
}

export function readClosedPlanAiResults(ownerId: string, sermonId: string, mode: PlanResultMode, known: string[]) {
  return readClosedPlanReceipts(createAiResultReceiptStore(ownerId), { sermonId, mode }, known);
}

export function closePlanAiResult(ownerId: string, sermonId: string, mode: PlanResultMode, id: string) {
  return closePlanReceipt(createAiResultReceiptStore(ownerId), { sermonId, mode }, id);
}

export function settlePlanAiResult(ownerId: string, sermonId: string, mode: PlanResultMode, id: string) {
  return settlePlanReceipt(createAiResultReceiptStore(ownerId), { ownerId, scope: { sermonId, mode }, id, now: new Date() });
}

export function createAiPromptTelemetry(eventId: string, fields: object, terminal?: boolean): Promise<void> {
  return createAiPromptTelemetryRecord(eventId, fields, terminal);
}

export function settleAiPromptTelemetry(eventId: string, fields: object): Promise<void> {
  return updateAiPromptTelemetryOutcome(eventId, fields);
}
