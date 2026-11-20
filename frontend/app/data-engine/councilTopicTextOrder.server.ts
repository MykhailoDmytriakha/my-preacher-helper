import { createHash } from 'node:crypto';

import { COUNCIL_TOPIC_TEXT_POLICY, COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED } from './councilTopicTextAction';
import { documentProofHeadroom } from './documentProofBudget.server';
import { existingRowFields, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { orderRowText } from './rowTextOrder.server';

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
  if (!order.displaced.length || command.kind !== 'update') return [];
  const change = command.changes.find(item => item.path[0] === 'topics');
  return policy.fields.flatMap(field => {
    const target = policy.target(field);
    const opening = existingRowFields(change?.before.value, target);
    const proposed = existingRowFields(change?.after.value, target);
    const accepted = existingRowFields(current.value?.topics, target);
    return order.displaced.flatMap(entry => {
      if (entry.field !== field) return [];
      const { rowId, value, winnerValue } = entry;
      const before = opening.get(rowId), mine = proposed.get(rowId), stored = accepted.get(rowId);
      if (before === undefined || mine === undefined || stored === undefined) return [];
      const code = stored === winnerValue && mine === value ? COUNCIL_TOPIC_TEXT_SETTLED
        : stored === value && mine === winnerValue ? COUNCIL_TOPIC_TEXT_QUEUED : undefined;
      return code ? [{ path: rowConflictPath(rowId, target), code, base: rowConflictValue(before),
        mine: rowConflictValue(mine), theirs: rowConflictValue(stored) }] : [];
    });
  });
}

export function boundCouncilTopicTextMetadata(value: Record<string, unknown>, metadata: EngineMetadata | null | undefined) {
  if (!metadata || !('councilTopicTextProofs' in metadata) || documentProofHeadroom(value, metadata) >= 0) return metadata;
  return { ...metadata, councilTopicTextProofs: { text: { floor: metadata.revision, proofs: [] } } };
}
