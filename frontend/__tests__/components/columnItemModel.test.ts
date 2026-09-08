import { buildColumnItemIndex } from '@/components/column/columnItemModel';

import type { Item } from '@/models/models';

const item = (id: string, outlinePointId?: string, isLocked?: boolean): Item =>
  ({ id, content: id, customTagNames: [], outlinePointId, isLocked });

it('groups once while retaining input order, identity, orphan links and mixed lock state', () => {
  const items = [item('free'), item('a', 'point', true), item('orphan', 'missing', true), item('b', 'point'), item('empty-link', '')];
  items.forEach(Object.freeze);
  Object.freeze(items);
  const result = buildColumnItemIndex(items);
  expect(result.unassigned).toEqual([items[0], items[4]]);
  expect(result.byPoint.get('point')).toEqual({ items: [items[1], items[3]], isLocked: false });
  expect(result.byPoint.get('missing')).toEqual({ items: [items[2]], isLocked: true });
  expect(result.byPoint.get('point')?.items[0]).toBe(items[1]);
  expect(items.map(value => value.id)).toEqual(['free', 'a', 'orphan', 'b', 'empty-link']);
});

it('does not invent empty locked groups or confuse IDs with object prototype properties', () => {
  expect(buildColumnItemIndex([])).toEqual({ byPoint: new Map(), unassigned: [] });
  const result = buildColumnItemIndex([item('a', '__proto__', true), item('b', '__proto__', true), item('c', 'constructor', false)]);
  expect(result.byPoint.get('__proto__')?.isLocked).toBe(true);
  expect(result.byPoint.get('constructor')?.isLocked).toBe(false);
  expect(result.byPoint.has('unknown')).toBe(false);
});
