import { render } from '@testing-library/react';
import React from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';

import type { SermonOutline } from '@/models/models';

/**
 * THE BUG THIS GUARDS, IN THE OWNER'S WORDS: "не работает, что бы я ни поставил
 * там выше или ниже" — nothing could be dropped anywhere, on any seam.
 *
 * The board used to switch a drop target OFF whenever it could not accept what
 * was being dragged, which reads as a tidy rule and hides a fatal ordering
 * problem: with nothing in the air, EVERY target was off, and dnd-kit takes its
 * measurements as the drag begins — it measured a board with no targets on it,
 * then dragged over that empty list for the rest of the gesture. `onDragOver`
 * never fired once, and every drop reported `over: null`.
 *
 * So the invariant is about REGISTRATION, not about styling: a drop target is
 * registered while the board is idle, and what a particular drag may hit is
 * decided when collisions are resolved. Anything that gates `useDroppable`'s
 * `disabled` on an active drag brings the whole board back down.
 */

const droppableCalls: { id: string; disabled: boolean }[] = [];

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MeasuringStrategy: { Always: 'always' },
  PointerSensor: function PointerSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
  pointerWithin: () => [],
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: ({ id, disabled }: { id: string; disabled?: boolean }) => {
    droppableCalls.push({ id: String(id), disabled: Boolean(disabled) });
    return { setNodeRef: () => {}, isOver: false };
  },
}));

const outline = (): SermonOutline => ({
  introduction: [
    { id: 'p1', text: 'Opening', subPoints: [{ id: 's1', text: 'A child', position: 0 }] },
    { id: 'p2', text: 'Second' },
  ],
  main: [],
  conclusion: [],
});

describe('drop targets are registered while the board is idle', () => {
  beforeEach(() => {
    droppableCalls.length = 0;
  });

  const renderBoard = (isReadOnly = false) =>
    render(<OutlineBoard value={outline()} onChange={() => {}} isReadOnly={isReadOnly} />);

  it('registers the seams between points with nothing being dragged', () => {
    renderBoard();
    const seams = droppableCalls.filter((c) => c.id.startsWith('gap:'));

    expect(seams.length).toBeGreaterThan(0);
    expect(seams.every((c) => c.disabled === false)).toBe(true);
  });

  it('registers the seams between sub-points too', () => {
    renderBoard();
    const subSeams = droppableCalls.filter((c) => c.id.startsWith('subgap:'));

    expect(subSeams.length).toBeGreaterThan(0);
    expect(subSeams.every((c) => c.disabled === false)).toBe(true);
  });

  it('registers cards and columns, so a drag can nest or change section', () => {
    renderBoard();

    expect(droppableCalls.some((c) => c.id.startsWith('into-point:') && !c.disabled)).toBe(true);
    expect(droppableCalls.some((c) => c.id.startsWith('section:') && !c.disabled)).toBe(true);
  });

  it('leaves no drop target disabled on an editable board', () => {
    renderBoard();
    expect(droppableCalls.filter((c) => c.disabled)).toEqual([]);
  });

  it('does disable them when the board is read-only — the one legitimate reason', () => {
    renderBoard(true);
    expect(droppableCalls.length).toBeGreaterThan(0);
    expect(droppableCalls.every((c) => c.disabled)).toBe(true);
  });
});
