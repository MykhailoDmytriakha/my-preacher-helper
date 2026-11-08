import { GROUP_MEETING_FIELD_POLICY } from './groupMeetingFieldAction';
import { metadataAfterRowDetails, orderRowDetails } from './rowDetailOrder.server';

import type { DataCommand, ResourceSnapshot } from './types';

export const GROUP_MEETING_FIELD_HISTORY = GROUP_MEETING_FIELD_POLICY.history;

export function orderGroupMeetingFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  return orderRowDetails(command, current, raw, serverMs, GROUP_MEETING_FIELD_POLICY);
}

export function metadataAfterGroupMeetingFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderGroupMeetingFields>) {
  return metadataAfterRowDetails(snapshot, raw, GROUP_MEETING_FIELD_POLICY, order);
}
