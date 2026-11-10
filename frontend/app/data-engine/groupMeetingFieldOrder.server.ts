import { object } from './fieldValues';
import { GROUP_MEETING_FIELDS, GROUP_MEETING_FIELD_POLICY, MEETING_ROW_BIRTH, meetingFieldTarget } from './groupMeetingFieldAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { metadataAfterRowDetails, needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { existingRowField } from './rowFieldAction';
import { readRowObservation, uncertainRowChange } from './rowFieldOrder.server';

import type { DataCommand, ResourceSnapshot } from './types';

export const GROUP_MEETING_FIELD_HISTORY = GROUP_MEETING_FIELD_POLICY.history;

export function orderGroupMeetingFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number, knownOpeningRow?: string) {
  const order = orderRowDetails(command, current, raw, serverMs, GROUP_MEETING_FIELD_POLICY, undefined, knownOpeningRow);
  if (command.kind !== 'update' || !knownOpeningRow || !current.metadata) return order;
  const change = command.changes.find(item => item.path[0] === 'meetingDates');
  const revision = current.metadata.revision;
  for (const field of GROUP_MEETING_FIELDS) {
    const target = meetingFieldTarget(field);
    const before = existingRowField(change?.before.value, knownOpeningRow, target);
    const after = existingRowField(change?.after.value, knownOpeningRow, target);
    const live = existingRowField(current.value?.meetingDates, knownOpeningRow, target);
    const born = existingRowField(current.value?.meetingDates, knownOpeningRow, MEETING_ROW_BIRTH);
    if (!born || before !== null || typeof after !== 'string') continue;
    const submitted = command.groupMeetingFieldActions?.[field];
    const action = readRowObservation(command, submitted, target, serverMs);
    if (action && action.rowId === knownOpeningRow && action.observedRevision <= revision && object(submitted)
      && submitted.rowCreatedAt === born && matchesRowDetailBirth(command.changes, { ...action, rowCreatedAt: born }, MEETING_ROW_BIRTH)) continue;
    if (live === after) {
      const plans = order.fields.get(field) ?? [];
      order.fields.set(field, [...plans, { command, sameValueWithoutOrder: knownOpeningRow }]);
    } else if (live === null && needsLegacyRowDetailOpeningReview(raw, GROUP_MEETING_FIELD_POLICY, field, knownOpeningRow, born, null, revision)) {
      order.uncertain.push(uncertainRowChange({ rowId: knownOpeningRow, before, after, time: null, observedRevision: 0 }, target));
    }
  }
  return order;
}

export function metadataAfterGroupMeetingFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderGroupMeetingFields>) {
  return metadataAfterRowDetails(snapshot, raw, GROUP_MEETING_FIELD_POLICY, order);
}
