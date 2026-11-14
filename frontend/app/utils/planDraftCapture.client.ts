'use client';

import { readDraftAddress } from './draftAddress';
import { matchesDraftCapture, readDraftsStrict, retireDraftCapture, type DurableDraft } from './durableDraft';
import { liveNodeIds } from './planTextStorage';

import type { CapturedDraftWrite, DraftCapturePort } from './draftCaptureRecovery.client';
import type { Sermon } from '@/models/models';

export const PLAN_DRAFT_CAPTURE_PREFIX = 'draft-capture:v1:plan-transfer:';
export type PlanDraftBinding = { key: string; proof: string | DurableDraft<string> };
type PlanTransferBinding = { pointId: string; subPointId: string; copies: PlanDraftBinding[] };

export function planTransferCaptureScope(pointId: string, subPointId: string, copies: PlanDraftBinding[]): string | undefined {
  if (copies.length) return PLAN_DRAFT_CAPTURE_PREFIX + encodeURIComponent(JSON.stringify({ pointId, subPointId, copies }));
}

function readBinding(scope: string): PlanTransferBinding | null {
  try {
    const binding = JSON.parse(decodeURIComponent(scope.slice(PLAN_DRAFT_CAPTURE_PREFIX.length))) as Partial<PlanTransferBinding> | null;
    if (!binding || typeof binding.pointId !== 'string' || typeof binding.subPointId !== 'string'
      || !binding.pointId || !binding.subPointId || binding.pointId === binding.subPointId
      || !Array.isArray(binding.copies) || binding.copies.length === 0
      || !binding.copies.every(copy => copy && typeof copy.key === 'string'
        && (typeof copy.proof === 'string' ? Boolean(copy.proof)
          : copy.proof && typeof copy.proof.value === 'string' && Number.isFinite(copy.proof.savedAt)))) return null;
    return { pointId: binding.pointId, subPointId: binding.subPointId, copies: binding.copies };
  } catch { return null; }
}

function activeTransfer(value: unknown, binding: PlanTransferBinding, owner: string): string | undefined {
  const sermon = value as Sermon | null | undefined;
  if (!sermon || sermon.userId !== owner) return undefined;
  const nodes = liveNodeIds(sermon.outline);
  if (!nodes.has(binding.pointId) || nodes.has(binding.subPointId)) return undefined;
  return sermon.planText?.[binding.pointId];
}

/** Only an acknowledged transfer can retire the exact private copies it carried. */
export async function reconcilePlanTransferDrafts(owner: string, captured: CapturedDraftWrite,
  port: DraftCapturePort, active: () => boolean): Promise<void> {
  if (captured.owner !== owner || captured.resource.collection !== 'sermons') return;
  const binding = readBinding(captured.scope);
  if (!binding || binding.pointId !== captured.planTransfer?.pointId || binding.subPointId !== captured.planTransfer.subPointId) return;
  const keys = binding.copies.map(copy => copy.key);
  const addresses = keys.map(readDraftAddress);
  if (!addresses.every(address => address?.owner === owner && address.documentId === captured.resource.id
    && [`plan:${binding.pointId}`, `plan:${binding.subPointId}`].includes(address.aggregate))) return;
  if (captured.state === 'cancelled') {
    if (active()) await port.releaseWriteCapture(captured.scope, captured.requestId);
    return;
  }
  if (captured.state !== 'acknowledged') return;
  const intended = activeTransfer(captured.value, binding, owner);
  if (typeof intended !== 'string' || activeTransfer(captured.acceptedValue, binding, owner) !== intended) {
    if (active()) await port.releaseWriteCapture(captured.scope, captured.requestId);
    return;
  }
  const drafts = readDraftsStrict(keys);
  if (!drafts) return;
  for (const { key, proof } of binding.copies) {
    const draft = drafts.get(key);
    if (!active()) return;
    if (draft && matchesDraftCapture(draft, proof) && (typeof draft.value !== 'string' || !retireDraftCapture(key, proof, draft.value))) return;
  }
  const remaining = readDraftsStrict(keys);
  if (active() && remaining && binding.copies.every(({ key, proof }) => !matchesDraftCapture(remaining.get(key), proof))) {
    await port.releaseWriteCapture(captured.scope, captured.requestId);
  }
}
