import type { Group, GroupFlowItem } from '@/models/models';

/** Preserve the legacy service's read shape on every transport. */
export function normalizeStoredGroupFlow(flow: GroupFlowItem[] = []): GroupFlowItem[] {
  return [...flow]
    .filter(item => Boolean(item?.id) && Boolean(item.templateId))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));
}

export function hydrateGroup(group: Group): Group {
  return { ...group, templates: group.templates || [], flow: normalizeStoredGroupFlow(group.flow || []),
    meetingDates: group.meetingDates || [], status: group.status || 'draft' };
}
