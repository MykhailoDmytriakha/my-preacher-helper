import {
  createFlowItem,
  createTemplate,
  duplicateFlowItem,
  getFilledFlowItems,
  moveFlowItem,
  normalizeFlow,
  removeFlowItem,
} from '@/utils/groupFlow';

describe('groupFlow utils', () => {
  it('creates template with defaults and overrides', () => {
    const template = createTemplate('topic', {
      title: 'Custom topic',
      status: 'filled',
      questions: ['Q1'],
    });

    expect(template.type).toBe('topic');
    expect(template.title).toBe('Custom topic');
    expect(template.status).toBe('filled');
    expect(template.content).toBe('');
    expect(template.questions).toEqual(['Q1']);
    expect(template.id).toContain('template-');
    expect(template.createdAt).toBeTruthy();
    expect(template.updatedAt).toBeTruthy();
  });

  it('creates and normalizes flow items with sequential order', () => {
    const a = createFlowItem('template-a', 8);
    const b = createFlowItem('template-b', 2);

    const normalized = normalizeFlow([a, b]);
    expect(normalized[0].templateId).toBe('template-b');
    expect(normalized[0].order).toBe(1);
    expect(normalized[1].templateId).toBe('template-a');
    expect(normalized[1].order).toBe(2);
  });

  it('moves flow items up/down and keeps boundaries stable', () => {
    const flow = normalizeFlow([
      { id: 'f1', templateId: 't1', order: 2, durationMin: null },
      { id: 'f2', templateId: 't2', order: 1, durationMin: null },
      { id: 'f3', templateId: 't3', order: 3, durationMin: null },
    ]);

    const movedDown = moveFlowItem(flow, 'f2', 'down');
    expect(movedDown.map((item) => item.id)).toEqual(['f1', 'f2', 'f3']);
    expect(movedDown.map((item) => item.order)).toEqual([1, 2, 3]);

    const movedUp = moveFlowItem(movedDown, 'f3', 'up');
    expect(movedUp.map((item) => item.id)).toEqual(['f1', 'f3', 'f2']);

    const topBoundary = moveFlowItem(movedUp, 'f1', 'up');
    expect(topBoundary.map((item) => item.id)).toEqual(['f1', 'f3', 'f2']);

    const missing = moveFlowItem(movedUp, 'missing', 'down');
    expect(missing.map((item) => item.id)).toEqual(['f1', 'f3', 'f2']);
  });

  it('duplicates and removes flow items', () => {
    const flow = normalizeFlow([
      { id: 'f1', templateId: 't1', order: 1, durationMin: null },
      { id: 'f2', templateId: 't2', order: 2, durationMin: null },
    ]);

    const duplicated = duplicateFlowItem(flow, 'f1');
    expect(duplicated).toHaveLength(3);
    expect(duplicated[0].id).toBe('f1');
    expect(duplicated[1].templateId).toBe('t1');
    expect(duplicated[1].id).not.toBe('f1');
    expect(duplicated.map((item) => item.order)).toEqual([1, 2, 3]);

    const notFoundDup = duplicateFlowItem(flow, 'unknown');
    expect(notFoundDup).toEqual(flow);

    const removed = removeFlowItem(duplicated, 'f2');
    expect(removed.map((item) => item.id)).toEqual([duplicated[0].id, duplicated[1].id]);
    expect(removed.map((item) => item.order)).toEqual([1, 2]);
  });

  it('returns only filled flow entries with resolved templates', () => {
    const templates = [
      {
        ...createTemplate('topic', { status: 'filled', title: 'Topic' }),
        id: 't1',
      },
      {
        ...createTemplate('scripture', { status: 'draft', title: 'Scripture' }),
        id: 't2',
      },
    ];
    const flow = [
      { id: 'f1', templateId: 't1', order: 2, durationMin: null },
      { id: 'f2', templateId: 'missing', order: 1, durationMin: null },
      { id: 'f3', templateId: 't2', order: 3, durationMin: null },
    ];

    const filled = getFilledFlowItems(flow, templates);
    expect(filled).toHaveLength(1);
    expect(filled[0].flowItem.id).toBe('f1');
    expect(filled[0].template?.id).toBe('t1');
  });
});
