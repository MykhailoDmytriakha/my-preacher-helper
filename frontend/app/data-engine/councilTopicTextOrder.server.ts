import { createHash } from 'node:crypto';

import { COUNCIL_TOPIC_TEXT_POLICY, COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED } from './councilTopicTextAction';
import { documentProofHeadroom } from './documentProofBudget.server';
import { orderRowText, settledRowDetailComparisons } from './rowTextOrder.server';

import type { RowDetailPolicy } from './rowDetailAction';
import type { RowDetailOrder } from './rowDetailOrder.server';
import type { RowValue } from './rowFieldAction';
import type { DataCommand, EngineMetadata, ResourceSnapshot } from './types';

export const councilTopicTextOrderPolicy = {
  ...COUNCIL_TOPIC_TEXT_POLICY,
  proofRowId: (id: string) => createHash('sha256').update(id).digest('base64url'),
};

export function orderCouncilTopicText(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const order = orderRowText(command, current, raw, serverMs, councilTopicTextOrderPolicy);
  return { ...order, settled: settledCouncilTopicDetails(command, current, councilTopicTextOrderPolicy, order) };
}

/** Expose a proven winner when a different field requires a choice for the same command. */
export function settledCouncilTopicDetails<Field extends string, Value extends RowValue>(command: DataCommand, current: ResourceSnapshot,
  policy: RowDetailPolicy<Field, Value>, order: RowDetailOrder<Field, Value>) {
  return settledRowDetailComparisons(command, current, policy, order, { settled: COUNCIL_TOPIC_TEXT_SETTLED, queued: COUNCIL_TOPIC_TEXT_QUEUED });
}

export function boundCouncilTopicTextMetadata(value: Record<string, unknown>, metadata: EngineMetadata | null | undefined) {
  if (!metadata || !('councilTopicTextProofs' in metadata) || documentProofHeadroom(value, metadata) >= 0) return metadata;
  return { ...metadata, councilTopicTextProofs: { text: { floor: metadata.revision, proofs: [] } } };
}
