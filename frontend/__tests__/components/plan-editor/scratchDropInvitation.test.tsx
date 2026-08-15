import { act, render, screen } from '@testing-library/react';
import React from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';

import type { ScratchNote, SermonOutline } from '@/models/models';

/**
 * Every point can take a note, so lifting one used to print "drop a note on this
 * point" under EVERY point at once — five sentences shouting the same thing while
 * the actual answer is wherever the pointer happens to be. The owner had already
 * named this on the plan side: "подсвечивается очень много всего".
 *
 * The rule these tests hold: while a note is in the air, candidates show a quiet
 * outline and nothing more; the words belong to the single zone under the pointer,
 * where they read as confirmation instead of instruction.
 */

let handlers: { onDragStart?: (e: unknown) => void; onDragEnd?: (e: unknown) => void } = {};
let hoveredId: string | null = null;

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragStart?: (e: unknown) => void;
    onDragEnd?: (e: unknown) => void;
  }) => {
    handlers = { onDragStart, onDragEnd };
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MeasuringStrategy: { Always: 'always' },
  PointerSensor: function PointerSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
  pointerWithin: () => [],
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: ({ id }: { id: string }) => ({
    setNodeRef: () => {},
    isOver: hoveredId === String(id),
  }),
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

let placed: { noteId: string; target: unknown }[] = [];
let reordered: { noteId: string; groupIds: string[]; index: number }[] = [];

const renderBoard = () =>
  render(
    <OutlineBoard
      value={outline()}
      onChange={() => {}}
      scratch={{
        pool: [note],
        notesById: new Map([[note.id, note]]),
        placements: {},
        onPlace: (noteId, target) => placed.push({ noteId, target }),
        onReorder: (noteId, groupIds, index) => reordered.push({ noteId, groupIds, index }),
        renderNote: (n) => <span>{n.text}</span>,
      }}
    />
  );

const liftTheNote = () =>
  act(() => {
    handlers.onDragStart?.({ active: { id: 'note:n1' } });
  });

describe('a note in the air: one zone speaks, the rest stay quiet', () => {
  beforeEach(() => {
    hoveredId = null;
    handlers = {};
  });

  it('says nothing anywhere while no zone is hovered', () => {
    renderBoard();
    liftTheNote();

    expect(screen.queryAllByText('scratch.board.dropHerePoint')).toHaveLength(0);
  });

  it('puts the words on the hovered zone only', () => {
    hoveredId = 'scratch-point:p2';
    renderBoard();
    liftTheNote();

    // Three points could each take the note; exactly one of them says so.
    expect(screen.getAllByText('scratch.board.dropHerePoint')).toHaveLength(1);
  });

  it('keeps the strips present at rest, so the board cannot jump when a drag starts', () => {
    renderBoard();
    const before = screen.getAllByTestId(/scratch-point-drop-zone-/).length;

    liftTheNote();

    expect(screen.getAllByTestId(/scratch-point-drop-zone-/)).toHaveLength(before);
    expect(before).toBe(3);
  });
});

/**
 * The plan side taught this lesson the hard way: a target can be lit, hovered and
 * completely dead, because the drop handler has no branch for it. The line was
 * drawn, the card flew, nothing happened. These four are every place a note is
 * allowed to land — each one asserted to actually file the note.
 */
describe('every target a note may land on actually files it', () => {
  const drop = (over: string) =>
    act(() => {
      handlers.onDragEnd?.({ active: { id: 'note:n1' }, over: { id: over } });
    });

  beforeEach(() => {
    placed = [];
    hoveredId = null;
    handlers = {};
    renderBoard();
  });

  it('files it on a point', () => {
    drop('scratch-point:p2');
    expect(placed).toEqual([{ noteId: 'n1', target: { pointId: 'p2' } }]);
  });

  it('files it on a sub-point, finding the parent point itself', () => {
    drop('scratch-subpoint:s1');
    expect(placed).toEqual([{ noteId: 'n1', target: { pointId: 'p1', subPointId: 's1' } }]);
  });

  it('files it on the card itself, which means that point', () => {
    drop('into-point:p3');
    expect(placed).toEqual([{ noteId: 'n1', target: { pointId: 'p3' } }]);
  });

  it('sends it back to the pool', () => {
    drop('scratch-note-pool');
    expect(placed).toEqual([{ noteId: 'n1', target: null }]);
  });

  it('does nothing on a seam — a note has no place in the plan\'s order', () => {
    drop('gap:main:0');
    expect(placed).toEqual([]);
  });
});

/**
 * "Наброски не могу поменять местами внутри подпункта."
 *
 * Two notes on one row and no way to say which comes first: the row itself was
 * the only target inside it, and dropping a note where it already lives means
 * nothing changed. The seam between them carries both halves of the intention —
 * the row it belongs to, and its place among the neighbours.
 */
describe('the seam between two notes on one row', () => {
  const drop = (over: string) =>
    act(() => {
      handlers.onDragEnd?.({ active: { id: 'note:n2' }, over: { id: over } });
    });

  beforeEach(() => {
    placed = [];
    reordered = [];
    hoveredId = null;
    handlers = {};
    render(
      <OutlineBoard
        value={outline()}
        onChange={() => {}}
        scratch={{
          pool: [],
          notesById: new Map([[note.id, note], [sibling.id, sibling]]),
          placements: { n1: { pointId: 'p2' }, n2: { pointId: 'p2' } },
          onPlace: (noteId, target) => placed.push({ noteId, target }),
          onReorder: (noteId, groupIds, index) => reordered.push({ noteId, groupIds, index }),
          renderNote: (n) => <span>{n.text}</span>,
        }}
      />
    );
  });

  it('moves the note above its neighbour', () => {
    drop('notegap:scratch-point:p2::0');

    expect(reordered).toEqual([{ noteId: 'n2', groupIds: ['n1', 'n2'], index: 0 }]);
  });

  it('keeps the note on the same row while reordering it', () => {
    drop('notegap:scratch-point:p2::0');

    expect(placed).toEqual([{ noteId: 'n2', target: { pointId: 'p2' } }]);
  });

  it('a seam in another row both re-files and places it', () => {
    drop('notegap:scratch-subpoint:s1::0');

    expect(placed).toEqual([{ noteId: 'n2', target: { pointId: 'p1', subPointId: 's1' } }]);
    expect(reordered[0].index).toBe(0);
  });

  it('a seam in the pool sends it home, at the chosen place', () => {
    drop('notegap:scratch-note-pool::1');

    expect(placed).toEqual([{ noteId: 'n2', target: null }]);
    expect(reordered[0].index).toBe(1);
  });
});

/**
 * The pool is a grid, so its seam stands at a card's leading edge rather than
 * between rows. One seam per card plus one after the last: two neighbours sharing
 * an index would register the same droppable id twice, and the library would keep
 * whichever won the race.
 */
describe('the pool can be reordered too', () => {
  const poolOf = (...ns: ScratchNote[]) =>
    render(
      <OutlineBoard
        value={outline()}
        onChange={() => {}}
        scratch={{
          pool: ns,
          notesById: new Map(ns.map((n) => [n.id, n])),
          placements: {},
          onPlace: (noteId, target) => placed.push({ noteId, target }),
          onReorder: (noteId, groupIds, index) => reordered.push({ noteId, groupIds, index }),
          renderNote: (n) => <span>{n.text}</span>,
        }}
      />
    );

  beforeEach(() => {
    placed = [];
    reordered = [];
    handlers = {};
  });

  it('reorders the pool without re-filing the note', () => {
    poolOf(note, sibling);
    act(() => {
      handlers.onDragEnd?.({ active: { id: 'note:n2' }, over: { id: 'notegap:scratch-note-pool::0' } });
    });

    expect(reordered).toEqual([{ noteId: 'n2', groupIds: ['n1', 'n2'], index: 0 }]);
    expect(placed).toEqual([{ noteId: 'n2', target: null }]);
  });

  it('gives each card one seam, and the row one more at its end', () => {
    const { container } = poolOf(note, sibling);
    const seams = container.querySelectorAll('[aria-hidden="true"][class*="-left-3"], [aria-hidden="true"][class*="-right-3"]');

    // Two cards → two leading edges + one trailing edge.
    expect(seams).toHaveLength(3);
  });
});
