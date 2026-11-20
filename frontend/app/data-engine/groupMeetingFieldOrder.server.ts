import { object } from './fieldValues';
import { GROUP_MEETING_FIELDS, GROUP_MEETING_FIELD_POLICY, MEETING_ROW_BIRTH, meetingFieldTarget } from './groupMeetingFieldAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { metadataAfterRowDetails, needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { existingRowFields } from './rowFieldAction';
import { readRowObservation, uncertainRowChange } from './rowFieldOrder.server';

import type { DataCommand, ResourceSnapshot } from './types';

export const GROUP_MEETING_FIELD_HISTORY = GROUP_MEETING_FIELD_POLICY.history;

export function orderGroupMeetingFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number, knownOpeningRow?: string) {
  const order = orderRowDetails(command, current, raw, serverMs, GROUP_MEETING_FIELD_POLICY, undefined, knownOpeningRow);
  const metadata = current.metadata;
  if (command.kind !== 'update' || command.resource.collection !== 'groups' || !metadata || metadata.deleted
    || command.generation !== metadata.generation) return order;
  const change = command.changes.find(item => item.path.length === 1 && item.path[0] === 'meetingDates');
  if (!change) return order;
  const openingBirths = existingRowFields(change.before.value, MEETING_ROW_BIRTH);
  const proposedBirths = existingRowFields(change.after.value, MEETING_ROW_BIRTH);
  const storedBirths = existingRowFields(current.value?.meetingDates, MEETING_ROW_BIRTH);
  for (const field of GROUP_MEETING_FIELDS) {
    const target = meetingFieldTarget(field);
    const openings = existingRowFields(change.before.value, target);
    const proposals = existingRowFields(change.after.value, target);
    const stored = existingRowFields(current.value?.meetingDates, target);
    const submitted = command.groupMeetingFieldActions?.[field];
    const action = readRowObservation(command, submitted, target, serverMs, { allowUnclocked: true });
    const observedRow = action && action.observedRevision <= metadata.revision && object(submitted) && typeof submitted.rowCreatedAt === 'string'
      && matchesRowDetailBirth(command.changes, { ...action, rowCreatedAt: submitted.rowCreatedAt }, MEETING_ROW_BIRTH) ? action.rowId : undefined;
    for (const [rowId, after] of proposals) {
      const before = openings.get(rowId), live = stored.get(rowId), born = storedBirths.get(rowId);
      if (!born || openingBirths.get(rowId) !== born || proposedBirths.get(rowId) !== born
        || before === undefined || after === undefined || before === after || observedRow === rowId) continue;
      if (live === after) {
        const plans = order.fields.get(field) ?? [];
        order.fields.set(field, [...plans, { command, sameValueWithoutOrder: rowId }]);
      } else if (live === before && needsLegacyRowDetailOpeningReview(raw, GROUP_MEETING_FIELD_POLICY, field, rowId, born, live, metadata.revision)) {
        order.uncertain.push(uncertainRowChange({ rowId, before, after, time: null, observedRevision: 0 }, target));
      }
    }
  }
  return order;
}

export function metadataAfterGroupMeetingFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderGroupMeetingFields>) {
  return metadataAfterRowDetails(snapshot, raw, GROUP_MEETING_FIELD_POLICY, order);
}
