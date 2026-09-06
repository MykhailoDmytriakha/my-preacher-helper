import { act, render, screen } from '@testing-library/react';
import React from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';

import type { ScratchNote, SermonOutline } from '@/models/models';

/**
 * A SCRATCH NOTE LANDS IN A CONTAINER, AND THE SLOT IS THE ONLY SIGNAL.
 *
 * The owner's words, after a week with the old board: "every time I get confused
 * where it will land — I see it lit one way and another way and don't understand
 * the difference; adding requires catching pixels; reordering — I don't know if
 * it will reorder or not." Measured live: one point card gave FOUR different
 * responses to the same note depending on which invisible band the pointer was
 * in, and hovering a sub-point filed the note on its parent.
 *
 * The rules these tests hold: the whole point card (or sub-point row, or the
 * pool) is the target; while a note is in the air exactly one container carries
 * a wash and the open slot inside it; the note's own place shows as a muted home
 * slot; a drop hands ONE operation on — which container, which index — and a
 * drop on the note's own place hands nothing on. No words anywhere.
 */

type Handlers = {
  onDragStart?: (e: unknown) => void;
  onDragOver?: (e: unknown) => void;
  onDragEnd?: (e: unknown) => void;
  onDragCancel?: () => void;
};
let handlers: Handlers = {};

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  }: { children: React.ReactNode } & Handlers) => {
    handlers = { onDragStart, onDragOver, onDragEnd, onDragCancel };
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MeasuringStrategy: { Always: 'always' },
  MouseSensor: function MouseSensor() {},
  TouchSensor: function TouchSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
  pointerWithin: () => [],
  rectIntersection: () => [],
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

const outline = (): SermonOutline => ({
  introduction: [
    { id: 'p1', text: 'Opening', subPoints: [{ id: 's1', text: 'A child', position: 0 }] },
    { id: 'p2', text: 'Second' },
  ],
  main: [{ id: 'p3', text: 'Third' }],
  conclusion: [],
});

const note: ScratchNote = { id: 'n1', text: 'A thought', createdAt: '2026-08-15T00:00:00.000Z' };
const sibling: ScratchNote = { id: 'n2', text: 'Another', createdAt: '2026-08-15T00:01:00.000Z' };

type Move = { noteId: string; target: unknown; neighbourIds: string[]; index: number };
let moves: Move[] = [];
let placed: { noteId: string; target: unknown }[] = [];

const lift = (noteId: string) => act(() => handlers.onDragStart?.({ active: { id: `note:${noteId}` } }));
const hover = (noteId: string, containerId: string, index: number) =>
  act(() =>
    handlers.onDragOver?.({
      active: { id: `note:${noteId}` },
      over: { id: containerId },
      collisions: [{ id: containerId, data: { containerId, index } }],
    })
  );
const drop = (noteId: string, containerId: string | null) =>
  act(() => handlers.onDragEnd?.({ active: { id: `note:${noteId}` }, over: containerId ? { id: containerId } : null, collisions: null }));

const boardWith = (pool: ScratchNote[], placements: Record<string, { pointId: string; subPointId?: string }>, all = [note, sibling]) =>
  render(
    <OutlineBoard
      value={outline()}
      onChange={() => {}}
      scratch={{
        pool,
        notesById: new Map(all.map((n) => [n.id, n])),
        placements,
        onPlace: (noteId, target) => placed.push({ noteId, target }),
        onMove: (noteId, target, neighbourIds, index) => moves.push({ noteId, target, neighbourIds, index }),
        renderNote: (n) => <span>{n.text}</span>,
      }}
    />
  );

beforeEach(() => {
  handlers = {};
  moves = [];
  placed = [];
});

describe('a note in the air: one container lit, one slot, no words', () => {
  it('prints no instruction anywhere, hovered or not', () => {
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-point:p2', 0);

    expect(document.body.textContent).not.toMatch(/drop|Перетащи|dropHere/i);
  });

  it('opens exactly one slot, inside the hovered container', () => {
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-point:p2', 0);

    const slots = document.querySelectorAll('[data-scratch-slot="target"]');
    expect(slots).toHaveLength(1);
    expect(screen.getByTestId('scratch-point-drop-zone-p2')).toContainElement(slots[0] as HTMLElement);
  });

  it('moves the slot to the sub-point row when that is what the pointer is over', () => {
    // The parent point's card contains the row; depth decides, and the slot says so.
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-sub:s1', 0);

    const slots = document.querySelectorAll('[data-scratch-slot="target"]');
    expect(slots).toHaveLength(1);
    expect(screen.getByTestId('scratch-subpoint-drop-zone-s1')).toContainElement(slots[0] as HTMLElement);
  });

  it('shows the note\'s own place as a home slot while it is aimed elsewhere', () => {
    boardWith([], { n1: { pointId: 'p2' } }, [note]);
    lift('n1');
    hover('n1', 'note-point:p3', 0);

    expect(screen.getByTestId('scratch-point-drop-zone-p2').querySelector('[data-scratch-slot="home"]')).not.toBeNull();
    expect(screen.getByTestId('scratch-point-drop-zone-p3').querySelector('[data-scratch-slot="target"]')).not.toBeNull();
  });

  it('keeps the strips present at rest, so the board cannot jump when a drag starts', () => {
    boardWith([note], {});
    const before = screen.getAllByTestId(/scratch-point-drop-zone-/).length;

    lift('n1');

    expect(screen.getAllByTestId(/scratch-point-drop-zone-/)).toHaveLength(before);
    expect(before).toBe(3);
  });

  it('closes every slot when the drag is cancelled', () => {
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-point:p2', 0);
    act(() => handlers.onDragCancel?.());

    expect(document.querySelectorAll('[data-scratch-slot]')).toHaveLength(0);
  });
});

/**
 * Every place a note may land hands on ONE operation: the container and the
 * index among its notes. The plan side taught this the hard way — a target can
 * be lit, hovered and completely dead when the drop handler has no branch for it.
 */
describe('every container a note may land in files it, with its place', () => {
  it('files it on a point', () => {
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-point:p2', 0);
    drop('n1', 'note-point:p2');

    expect(moves).toEqual([{ noteId: 'n1', target: { pointId: 'p2' }, neighbourIds: [], index: 0 }]);
  });

  it('files it on a sub-point, finding the parent point itself', () => {
    boardWith([note], {});
    lift('n1');
    hover('n1', 'note-sub:s1', 0);
    drop('n1', 'note-sub:s1');

    expect(moves).toEqual([{ noteId: 'n1', target: { pointId: 'p1', subPointId: 's1' }, neighbourIds: [], index: 0 }]);
  });

  it('sends it back to the pool, at the chosen place among the pooled notes', () => {
    boardWith([sibling], { n1: { pointId: 'p2' } });
    lift('n1');
    hover('n1', 'scratch-note-pool', 0);
    drop('n1', 'scratch-note-pool');

    expect(moves).toEqual([{ noteId: 'n1', target: null, neighbourIds: ['n2'], index: 0 }]);
  });

  it('does nothing on a seam or a card band — a note has no place in the plan\'s order', () => {
    boardWith([note], {});
    lift('n1');
    drop('n1', 'gap:main:0');
    drop('n1', 'into-point:p3');

    expect(moves).toEqual([]);
    expect(placed).toEqual([]);
  });

  it('lands at the end of a container when the drop names it without a hover', () => {
    boardWith([note], { n2: { pointId: 'p2' } });
    lift('n1');
    drop('n1', 'note-point:p2');

    expect(moves).toEqual([{ noteId: 'n1', target: { pointId: 'p2' }, neighbourIds: ['n2'], index: 1 }]);
  });
});

/**
 * "Наброски не могу поменять местами внутри подпункта" — and, a month later,
 * "ставлю после самой последней, а она становится предпоследней". Order is part
 * of the same operation as placement, and the index is counted in the list the
 * person sees: without the note in the air.
 */
describe('reordering inside one container', () => {
  it('moves the second note above the first', () => {
    boardWith([], { n1: { pointId: 'p2' }, n2: { pointId: 'p2' } });
    lift('n2');
    hover('n2', 'note-point:p2', 0);
    drop('n2', 'note-point:p2');

    expect(moves).toEqual([{ noteId: 'n2', target: { pointId: 'p2' }, neighbourIds: ['n1'], index: 0 }]);
  });

  it('moves the first note after the last', () => {
    boardWith([], { n1: { pointId: 'p2' }, n2: { pointId: 'p2' } });
    lift('n1');
    hover('n1', 'note-point:p2', 1);
    drop('n1', 'note-point:p2');

    expect(moves).toEqual([{ noteId: 'n1', target: { pointId: 'p2' }, neighbourIds: ['n2'], index: 1 }]);
  });

  it('hands nothing on when the note is let go where it already lives', () => {
    boardWith([], { n1: { pointId: 'p2' }, n2: { pointId: 'p2' } });
    lift('n2');
    hover('n2', 'note-point:p2', 1);
    expect(document.querySelectorAll('[data-scratch-slot="target"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-scratch-slot="home"]')).toHaveLength(1);
    drop('n2', 'note-point:p2');

    expect(moves).toEqual([]);
  });

  it('reorders the pool the same way', () => {
    boardWith([note, sibling], {});
    lift('n2');
    hover('n2', 'scratch-note-pool', 0);
    drop('n2', 'scratch-note-pool');

    expect(moves).toEqual([{ noteId: 'n2', target: null, neighbourIds: ['n1'], index: 0 }]);
  });

  it('re-files and places in one operation when the slot is in another row', () => {
    boardWith([], { n1: { pointId: 'p2' }, n2: { pointId: 'p2' } });
    lift('n2');
    hover('n2', 'note-sub:s1', 0);
    drop('n2', 'note-sub:s1');

    expect(moves).toEqual([{ noteId: 'n2', target: { pointId: 'p1', subPointId: 's1' }, neighbourIds: [], index: 0 }]);
  });
});
