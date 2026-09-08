import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { PointThoughtLane, UnassignedThoughtLane } from '@/components/column/ThoughtLanes';

import type { Item, SubPoint } from '@/models/models';

const mockTargets = new Map<string, Record<string, unknown>>();
let mockOver: string | null = null;
jest.mock('@dnd-kit/core', () => ({ useDroppable: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
  mockTargets.set(id, data);
  return { setNodeRef: jest.fn(), isOver: mockOver === id };
} }));
jest.mock('@dnd-kit/sortable', () => ({ SortableContext: ({ children }: React.PropsWithChildren) => <>{children}</>, verticalListSortingStrategy: jest.fn() }));
jest.mock('@/components/PointNote', () => ({ __esModule: true, default: ({ note, onChange, isReadOnly }: { note?: string; onChange: (note: string) => void; isReadOnly: boolean }) =>
  <input aria-label="Point note" value={note ?? ''} onChange={event => onChange(event.target.value)} readOnly={isReadOnly} /> }));

const item = (id: string, position?: number, subPointId?: string): Item => ({ id, position, subPointId, content: id, customTagNames: [] });
const renderItem = (entry: Item, label?: string | null) => <div key={entry.id} data-testid={`thought-${entry.id}`}>{entry.content}{label && ` / ${label}`}</div>;
const base = { containerId: 'main', outlinePointId: 'point', setNodeRef: jest.fn(), isOver: false, renderItem, t: (key: string) => key };
beforeEach(() => { mockTargets.clear(); mockOver = null; });

it('keeps interleaved cards and gap metadata linked to the nearest real items across empty subpoints', () => {
  const subPoints: SubPoint[] = [
    { id: 'last', text: 'Last', position: 50 },
    { id: 'empty', text: 'Empty', position: 30 },
    { id: 'nested', text: 'Nested', position: 20 },
  ];
  const items = [item('first', 10), item('child', 25, 'nested'), item('tail', 40)];
  Object.freeze(subPoints); Object.freeze(items);
  render(<PointThoughtLane {...base} pointItems={items} subPoints={subPoints} hasItems activeId="dragging" />);
  expect(screen.getAllByTestId(/^thought-/).map(node => node.textContent)).toEqual(['first', 'child / Nested', 'tail']);
  expect(mockTargets.get('sub-point-nested')).toEqual({ container: 'main', outlinePointId: 'point', subPointId: 'nested' });
  expect(mockTargets.get('outline-gap-point-2')).toEqual({ container: 'main', outlinePointId: 'point', subPointId: null, afterItemId: 'child', beforeItemId: 'tail', prevPosition: 20, nextPosition: 30 });
  expect(mockTargets.get('outline-gap-point-3')).toMatchObject({ afterItemId: 'child', beforeItemId: 'tail', prevPosition: 30, nextPosition: 40 });
  expect(mockTargets.get('outline-gap-point-4')).toMatchObject({ afterItemId: 'tail', beforeItemId: undefined });
  expect(screen.getByTestId('outline-gap-point-2')).toHaveClass('min-h-[24px]');
  expect(subPoints.map(point => point.id)).toEqual(['last', 'empty', 'nested']);
});

it('keeps empty boundaries, missing positions, recorder and note ownership explicit', () => {
  mockOver = 'sub-point-sub';
  const onSetSubPointNote = jest.fn();
  const props = { ...base, pointItems: [item('loose')], subPoints: [{ id: 'sub', text: 'Sub', position: 1, note: 'Before' }], hasItems: true, showNotes: true, onSetSubPointNote,
    renderSubPointRecorder: (point: SubPoint) => <button type="button">Record {point.id}</button> };
  const { rerender } = render(<PointThoughtLane {...props} activeId="dragging" />);
  expect(mockTargets.get('outline-gap-point-1')).toMatchObject({ beforeItemId: 'loose', afterItemId: undefined, nextPosition: undefined });
  expect(screen.getByTestId('sub-point-drop-sub')).toHaveClass('ring-1');
  expect(screen.getByRole('button', { name: 'Record sub' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Point note' }), { target: { value: 'After' } });
  expect(onSetSubPointNote).toHaveBeenCalledWith('point', 'sub', 'After');
  rerender(<PointThoughtLane {...props} isPointLocked />);
  expect(screen.getByRole('textbox', { name: 'Point note' })).toHaveAttribute('readonly');
  expect(screen.getByTestId('sub-point-drop-sub')).not.toHaveClass('ring-1');
  expect(screen.getByTestId('outline-gap-point-1')).toHaveClass('min-h-[4px]');
});

it('provides empty point/unassigned targets and preserves the unassigned renderer contract', () => {
  const { rerender } = render(<PointThoughtLane {...base} pointItems={[]} subPoints={[]} hasItems={false} />);
  expect(screen.getByText('structure.dropThoughtsHere')).toBeVisible();
  rerender(<UnassignedThoughtLane containerId="main" items={[]} renderItem={renderItem} t={base.t} />);
  expect(mockTargets.get('unassigned-main')).toEqual({ container: 'main', outlinePointId: null });
  expect(screen.getByText('structure.dropToUnassign')).toBeVisible();
  mockOver = 'unassigned-main';
  rerender(<UnassignedThoughtLane containerId="main" items={[item('unassigned')]} renderItem={renderItem} t={base.t} />);
  expect(screen.getByTestId('thought-unassigned')).toHaveTextContent(/^unassigned$/);
  expect(screen.getByText('structure.dropToUnassign')).toBeVisible();
});
