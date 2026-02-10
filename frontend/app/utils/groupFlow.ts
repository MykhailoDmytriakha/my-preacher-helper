import {
  GroupBlockStatus,
  GroupBlockTemplate,
  GroupBlockTemplateType,
  GroupFlowItem,
} from '@/models/models';

const buildId = (prefix: string) => {
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${unique}`;
};

const DEFAULT_TITLES: Record<GroupBlockTemplateType, string> = {
  announcement: 'Announcement',
  topic: 'Main Topic',
  scripture: 'Scripture',
  questions: 'Questions',
  explanation: 'Explanation',
  notes: 'Notes',
  prayer: 'Prayer Focus',
  custom: 'Custom Block',
};

export const createTemplate = (
  type: GroupBlockTemplateType,
  overrides?: Partial<GroupBlockTemplate>
): GroupBlockTemplate => {
  const now = new Date().toISOString();
  const status: GroupBlockStatus = overrides?.status || 'empty';

  return {
    id: buildId('template'),
    type,
    title: overrides?.title || DEFAULT_TITLES[type],
    summary: overrides?.summary,
    content: overrides?.content || '',
    scriptureRefs: overrides?.scriptureRefs || [],
    questions: overrides?.questions || [],
    status,
    createdAt: overrides?.createdAt || now,
    updatedAt: overrides?.updatedAt || now,
  };
};

export const createFlowItem = (templateId: string, order: number): GroupFlowItem => ({
  id: buildId('flow'),
  templateId,
  order,
  durationMin: null,
});

export const normalizeFlow = (flow: GroupFlowItem[]): GroupFlowItem[] =>
  [...flow]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));

export const moveFlowItem = (flow: GroupFlowItem[], itemId: string, direction: 'up' | 'down') => {
  const normalized = normalizeFlow(flow);
  const index = normalized.findIndex((item) => item.id === itemId);
  if (index === -1) return normalized;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= normalized.length) return normalized;

  const next = [...normalized];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  // Reindex before normalization so sorting by previous `order` values
  // does not revert the newly applied move.
  const reindexed = next.map((item, idx) => ({ ...item, order: idx + 1 }));
  return normalizeFlow(reindexed);
};

export const duplicateFlowItem = (flow: GroupFlowItem[], itemId: string) => {
  const normalized = normalizeFlow(flow);
  const index = normalized.findIndex((item) => item.id === itemId);
  if (index === -1) return normalized;

  const source = normalized[index];
  const clone: GroupFlowItem = {
    ...source,
    id: buildId('flow'),
    order: source.order + 1,
  };

  const next = [...normalized];
  next.splice(index + 1, 0, clone);
  return normalizeFlow(next);
};

export const removeFlowItem = (flow: GroupFlowItem[], itemId: string) =>
  normalizeFlow(flow.filter((item) => item.id !== itemId));

export const getFilledFlowItems = (flow: GroupFlowItem[], templates: GroupBlockTemplate[]) => {
  const byTemplateId = new Map(templates.map((template) => [template.id, template]));
  return normalizeFlow(flow)
    .map((flowItem) => ({ flowItem, template: byTemplateId.get(flowItem.templateId) }))
    .filter((entry) => entry.template && entry.template.status === 'filled');
};
