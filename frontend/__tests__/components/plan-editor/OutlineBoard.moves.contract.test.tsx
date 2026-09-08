import { act, render } from '@testing-library/react';
import React from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';

import type { SermonOutline } from '@/models/models';

let mockDrop: (event: unknown) => void;
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: React.PropsWithChildren<{ onDragEnd: typeof mockDrop }>) => { mockDrop = onDragEnd; return <>{children}</>; },
  DragOverlay: ({ children }: React.PropsWithChildren) => <>{children}</>,
  MeasuringStrategy: { Always: 'always' },
  MouseSensor: jest.fn(), TouchSensor: jest.fn(), KeyboardSensor: jest.fn(),
  pointerWithin: () => [], rectIntersection: () => [], useSensor: () => ({}), useSensors: () => [],
  useDraggable: () => ({ setNodeRef: jest.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));

const outline = (): SermonOutline => ({
  introduction: [{ id: 'source', text: 'Source', subPoints: [{ id: 'child', text: 'Child', position: 0, note: 'Child reminder' }] }],
  main: [{ id: 'target', text: 'Target', subPoints: [{ id: 'sibling', text: 'Sibling', position: 0 }] }],
  conclusion: [],
});
const placements = { direct: { pointId: 'source' }, nested: { pointId: 'source', subPointId: 'child' }, untouched: { pointId: 'target', subPointId: 'sibling' } };
function setup(isReadOnly = false) {
  const onChange = jest.fn(); const onPlace = jest.fn(); const onOutlinePointMoved = jest.fn(); const onSubPointMoved = jest.fn();
  const value = outline();
  render(<OutlineBoard value={value} onChange={onChange} isReadOnly={isReadOnly} onOutlinePointMoved={onOutlinePointMoved} onSubPointMoved={onSubPointMoved}
    scratch={{ pool: [], notesById: new Map(), placements, onPlace, renderNote: note => <span>{note.text}</span> }} />);
  return { value, onChange, onPlace, onOutlinePointMoved, onSubPointMoved };
}
const drop = (active: string, over: string | null) => act(() => mockDrop({ active: { id: active }, over: over ? { id: over } : null, collisions: null }));

it.each(['into-point:target', 'subgap:target:0'])('reparents a subpoint and its placed notes through %s', target => {
  const result = setup();
  drop('sub:child', target);
  expect(result.onChange).toHaveBeenCalledTimes(1);
  const next = result.onChange.mock.calls[0][0] as SermonOutline;
  expect(next.introduction[0].subPoints).toEqual([]);
  expect(next.main[0].subPoints?.map(point => point.id)).toEqual(target.startsWith('subgap') ? ['child', 'sibling'] : ['sibling', 'child']);
  expect(result.onPlace.mock.calls).toEqual([['nested', { pointId: 'target', subPointId: 'child' }]]);
  expect(result.onSubPointMoved).toHaveBeenCalledWith('child', 'source', 'target', 'main', next);
  expect(result.onOutlinePointMoved).not.toHaveBeenCalled();
  expect(result.value).toEqual(outline());
});

it.each(['into-point:target', 'subgap:target:0'])('nests a point with its children and carries every attached note through %s', target => {
  const result = setup();
  drop('point:source', target);
  const next = result.onChange.mock.calls[0][0] as SermonOutline;
  expect(next.introduction).toEqual([]);
  expect(next.main[0].subPoints?.map(point => point.id)).toEqual(target.startsWith('subgap') ? ['source', 'child', 'sibling'] : ['sibling', 'source', 'child']);
  expect(result.onPlace.mock.calls).toEqual([['direct', { pointId: 'target', subPointId: 'source' }], ['nested', { pointId: 'target', subPointId: 'child' }]]);
  expect(result.onOutlinePointMoved).not.toHaveBeenCalled();
});

it('promotes a subpoint and keeps its note/reminder and section notification', () => {
  const result = setup();
  drop('sub:child', 'gap:conclusion:0');
  const next = result.onChange.mock.calls[0][0] as SermonOutline;
  expect(next.conclusion).toEqual([{ id: 'child', text: 'Child', note: 'Child reminder' }]);
  expect(result.onPlace.mock.calls).toEqual([['nested', { pointId: 'child' }]]);
  expect(result.onOutlinePointMoved).toHaveBeenCalledWith('child', 'conclusion', next);
});

it('moves a point across sections without rewriting its note addresses', () => {
  const result = setup();
  drop('point:source', 'section:conclusion');
  const next = result.onChange.mock.calls[0][0] as SermonOutline;
  expect(next.conclusion[0]).toEqual(result.value.introduction[0]);
  expect(result.onOutlinePointMoved).toHaveBeenCalledWith('source', 'conclusion', next);
  expect(result.onPlace).not.toHaveBeenCalled();
});

it.each([['point:source', 'into-point:source'], ['point:missing', 'section:main'], ['point:source', null], ['unknown', 'section:main']])('does not emit for no-op/invalid drop %s -> %s', (active, target) => {
  const result = setup(); drop(active!, target);
  expect(result.onChange).not.toHaveBeenCalled(); expect(result.onPlace).not.toHaveBeenCalled();
});

it('keeps read-only structure and placements untouched', () => {
  const result = setup(true); drop('sub:child', 'into-point:target');
  expect(result.onChange).not.toHaveBeenCalled(); expect(result.onPlace).not.toHaveBeenCalled();
});
