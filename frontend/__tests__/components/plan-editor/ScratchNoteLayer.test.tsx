import { render, screen } from '@testing-library/react';
import React from 'react';
import { ScratchNotePool, ScratchNoteStrip } from '@/components/plan-editor/ScratchNoteLayer';
import { DraggableCard, DropZone } from '@/components/plan-editor/BoardDragPrimitives';
import { NOTE_POOL_ID } from '@/utils/boardDnd';
import type { ScratchLayerProps } from '@/components/plan-editor/outlineBoardTypes';

const mockDraggable = jest.fn(); const mockDroppable = jest.fn();
jest.mock('@dnd-kit/core', () => ({
  useDraggable: (args: unknown) => { mockDraggable(args); return { setNodeRef: () => {}, attributes: { role: 'button' }, listeners: { onKeyDown: () => {} }, isDragging: false }; },
  useDroppable: (args: unknown) => { mockDroppable(args); return { setNodeRef: () => {}, isOver: true }; },
}));
const note = { id: 'n', text: 'Full note', createdAt: '2026-01-01' };
const scratch: ScratchLayerProps = { pool: [note], notesById: new Map([['n', note]]), placements: {}, onPlace: jest.fn(), renderNote: n => <span>{n.text}</span>, poolHeader: 'Pool', poolEmptyLabel: 'Empty' };
const props = { scratch, notes: [note], isReadOnly: false, noteSlot: null, liftedNoteId: null, activeNoteHeight: 200, noteHomeOf: () => ({ containerId: NOTE_POOL_ID, index: 0 }) };

it('keeps the original DOM node mounted across lift, destination preview, and cancellation', () => {
  const { rerender, container } = render(<ScratchNotePool {...props} activeDrag={null} />);
  const original = screen.getByText('Full note').parentElement;
  rerender(<ScratchNotePool {...props} activeDrag={{ kind: 'note', id: 'n' }} liftedNoteId="n" noteSlot={{ containerId: 'note-point:p', index: 0, own: false }} />);
  expect(screen.getByText('Full note').parentElement).toBe(original);
  expect(original).toHaveClass('hidden');
  expect(container.querySelector('[data-scratch-slot="home"]')).toHaveStyle({ height: '200px' });
  rerender(<ScratchNotePool {...props} activeDrag={null} />);
  expect(screen.getByText('Full note').parentElement).toBe(original);
  expect(original).not.toHaveClass('hidden');
  expect(container.querySelector('[data-scratch-slot]')).toBeNull();
});

it('renders the shared slot in an empty placed-note strip and keeps its test/address seam', () => {
  const { container } = render(<ScratchNoteStrip {...props} notes={[]} testId="placed" containerId="note-point:p" liftedNoteId="n" noteSlot={{ containerId: 'note-point:p', index: 0, own: false }} />);
  expect(screen.getByTestId('placed')).toHaveAttribute('data-scratch-strip', 'note-point:p');
  expect(container.querySelector('[data-scratch-slot="target"]')).toHaveStyle({ height: '120px' });
});

it('keeps empty copy quiet while the pool is an active destination', () => {
  const { rerender } = render(<ScratchNotePool {...props} notes={[]} activeDrag={null} />);
  expect(screen.getByText('Empty')).toBeInTheDocument();
  rerender(<ScratchNotePool {...props} notes={[]} activeDrag={{ kind: 'note', id: 'n' }} noteSlot={{ containerId: NOTE_POOL_ID, index: 0, own: false }} />);
  expect(screen.queryByText('Empty')).not.toBeInTheDocument();
});

it('registers resting targets, paints only compatible active targets, and disables read-only handles', () => {
  const paint = jest.fn(() => null); const handle = jest.fn(() => null);
  const { rerender } = render(<><DropZone dropId="into-point:p" activeKind={null} render={paint} /><DraggableCard dragId="point:p" disabled>{handle}</DraggableCard></>);
  expect(mockDroppable).toHaveBeenLastCalledWith({ id: 'into-point:p', disabled: false });
  expect(paint).toHaveBeenLastCalledWith(expect.objectContaining({ isOver: false, isCandidate: false }));
  expect(handle).toHaveBeenLastCalledWith(expect.objectContaining({ handleProps: {} }));
  rerender(<DropZone dropId="into-point:p" activeKind="point" render={paint} />);
  expect(paint).toHaveBeenLastCalledWith(expect.objectContaining({ isOver: true, isCandidate: true }));
  rerender(<DropZone dropId="into-point:p" activeKind="point" disabled render={paint} />);
  expect(mockDroppable).toHaveBeenLastCalledWith({ id: 'into-point:p', disabled: true });
  expect(paint).toHaveBeenLastCalledWith(expect.objectContaining({ isOver: false }));
});
