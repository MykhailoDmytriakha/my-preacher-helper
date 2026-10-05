import { act, renderHook } from '@testing-library/react';
import { useOutlineBoardDrag } from '@/components/plan-editor/useOutlineBoardDrag';
import { indexScratchNotes } from '@/components/plan-editor/outlineBoardNotes';
import { NOTE_POOL_ID } from '@/utils/boardDnd';
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, Modifier } from '@dnd-kit/core';
import type { ScratchLayerProps } from '@/components/plan-editor/outlineBoardTypes';
import type { SermonOutline } from '@/models/models';

const mockPointer = jest.fn(() => [{ id: 'section:main' }, { id: 'into-point:p' }, { id: 'note-point:p' }]);
const mockRect = jest.fn(() => [{ id: 'section:main' }]);
jest.mock('@dnd-kit/core', () => ({ MouseSensor: 'mouse', TouchSensor: 'touch', KeyboardSensor: 'keyboard', useSensor: (type: string, options: unknown) => ({ type, options }), useSensors: (...sensors: unknown[]) => sensors, pointerWithin: () => mockPointer(), rectIntersection: () => mockRect() }));
const outline: SermonOutline = { introduction: [{ id: 'p', text: 'Point', subPoints: [{ id: 's', text: 'Sub', position: 0 }] }], main: [], conclusion: [] };
const n = { id: 'n', text: 'Note', createdAt: '2026-01-01' };
function setup(scratch?: ScratchLayerProps) {
  const index = indexScratchNotes(scratch);
  return renderHook(() => useOutlineBoardDrag(outline, scratch, id => index.get(id) ?? []));
}
const layer = (): ScratchLayerProps => ({ pool: [n], notesById: new Map([['n', n]]), placements: {}, onPlace: jest.fn(), onMove: jest.fn(), renderNote: () => null });
const start = (id = 'note:n') => ({ active: { id } } as DragStartEvent);
const hover = (containerId: string | null, index = 0) => ({ over: containerId ? { id: containerId } : null, collisions: containerId ? [{ id: containerId, data: { containerId, index } }] : [] } as unknown as DragOverEvent);
const collision = (pointer: { x: number; y: number } | null, id = 'note:n', rect: object | null = { left: 0, top: 0, width: 100, height: 100 }) => ({ active: { id }, pointerCoordinates: pointer, collisionRect: rect } as unknown as Parameters<CollisionDetection>[0]);
function box(node: Element, top: number, height: number) {
  jest.spyOn(node, 'getBoundingClientRect').mockReturnValue({ x: 0, y: top, top, bottom: top + height, left: 0, right: 200, width: 200, height, toJSON: () => ({}) } as DOMRect);
}
let fixture: HTMLDivElement;
const originalElements = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
beforeEach(() => { fixture = document.createElement('div'); document.body.append(fixture); });
afterEach(() => { fixture.remove(); if (originalElements) Object.defineProperty(document, 'elementsFromPoint', originalElements); else Reflect.deleteProperty(document, 'elementsFromPoint'); Object.defineProperty(window, 'scrollY', { value: 0, configurable: true }); });

it('reads live nested containers, caches stationary-pointer remeasures, and invalidates on scroll', () => {
  fixture.innerHTML = '<div data-note-container="note-point:p"><div data-note-container="note-sub:s"><div data-scratch-strip="note-sub:s"><div data-scratch-note="other">Other</div></div></div></div>';
  const point = fixture.firstElementChild!; const sub = point.firstElementChild!; const card = sub.querySelector('[data-scratch-note]')!;
  box(card, 100, 100);
  const hits = jest.fn(() => [card, sub, point]); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  act(() => result.current.onDragStart(start()));
  const first = result.current.collisionDetection(collision({ x: 50, y: 120 }));
  expect(first).toEqual([{ id: 'note-sub:s', data: { containerId: 'note-sub:s', index: 0 } }]);
  hits.mockReturnValue([point]);
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toBe(first);
  expect(hits).toHaveBeenCalledTimes(1);
  Object.defineProperty(window, 'scrollY', { value: 10, configurable: true });
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
  expect(hits).toHaveBeenCalledTimes(2);
  act(() => result.current.cancelDrag()); act(() => result.current.onDragStart(start()));
  result.current.collisionDetection(collision({ x: 50, y: 120 }));
  expect(hits).toHaveBeenCalledTimes(3);
});

it('measures the inner card, retains its home at lift-off, and anchors a clipped overlay handle', () => {
  fixture.innerHTML = `<div data-note-container="${NOTE_POOL_ID}"><div data-scratch-strip="${NOTE_POOL_ID}"><div data-scratch-note="n"><article>Note</article></div><div data-scratch-note="other">Other</div></div></div>`;
  const wrapper = fixture.querySelector('[data-scratch-note="n"]')!; const card = wrapper.firstElementChild!; box(wrapper, 0, 400); box(card, 0, 300); box(fixture.querySelector('[data-scratch-note="other"]')!, 400, 100);
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [card], configurable: true });
  const { result } = setup(layer()); act(() => result.current.onDragStart(start()));
  expect(result.current.activeNoteHeight).toBe(300); expect(result.current.liftedNoteId).toBe('n');
  expect(result.current.collisionDetection(collision({ x: 30, y: 100 }))).toEqual([{ id: NOTE_POOL_ID, data: { containerId: NOTE_POOL_ID, index: 0 } }]);
  const overlay = document.createElement('div'); Object.defineProperty(overlay, 'offsetHeight', { value: 120 }); result.current.overlayCardRef.current = overlay;
  const args = { active: { id: 'note:n' }, transform: { x: 2, y: 10, scaleX: 1, scaleY: 1 } } as unknown as Parameters<Modifier>[0];
  expect(result.current.keepHandleUnderFinger(args)).toEqual({ ...args.transform, y: 190 });
  expect(result.current.keepHandleUnderFinger({ ...args, active: { id: 'point:p' } } as Parameters<Modifier>[0])).toBe(args.transform);
  act(() => result.current.cancelDrag());
  expect(result.current.activeDrag).toBeNull(); expect(result.current.activeNoteHeight).toBe(0); expect(result.current.liftedNoteId).toBeNull();
});

it('keeps one slot while hovering, drops atomically, and clears an invalid hover', () => {
  const scratch = layer(); const { result } = setup(scratch); act(() => result.current.onDragStart(start()));
  act(() => result.current.onDragOver(hover('note-sub:s'))); const slot = result.current.noteSlot;
  act(() => result.current.onDragMove(hover('note-sub:s'))); expect(result.current.noteSlot).toBe(slot);
  act(() => result.current.handleNoteDrop({ kind: 'note', id: 'n' }, { over: null, collisions: null } as DragEndEvent));
  expect(scratch.onMove).toHaveBeenCalledWith('n', { pointId: 'p', subPointId: 's' }, [], 0); expect(scratch.onPlace).not.toHaveBeenCalled();
  act(() => result.current.onDragOver(hover(null))); expect(result.current.noteSlot).toBeNull(); expect(result.current.hoveredDropId).toBeNull();
});

it('uses keyboard rectangle coordinates and the structural collision policy', () => {
  const hits = jest.fn(() => []); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup();
  expect(result.current.collisionDetection(collision(null))).toEqual([]); expect(hits).toHaveBeenCalledWith(50, 50);
  expect(result.current.collisionDetection(collision({ x: 10, y: 10 }, 'point:p'))).toEqual([{ id: 'into-point:p' }, { id: 'section:main' }]);
  expect(result.current.collisionDetection(collision(null, 'sub:s'))).toEqual([{ id: 'section:main' }]);
  act(() => result.current.onDragMove(hover('note-point:p'))); expect(result.current.noteSlot).toBeNull();
  expect(result.current.noteHomeOf('missing')).toBeNull();
});

it('treats a scroll of the board inside its own container as a move', () => {
  fixture.innerHTML = '<div data-board-scroller><div data-note-container="note-point:p"><div data-note-container="note-sub:s"><div data-scratch-strip="note-sub:s"><div data-scratch-note="other">Other</div></div></div></div></div>';
  const scroller = fixture.firstElementChild as HTMLElement; const point = scroller.firstElementChild!; const sub = point.firstElementChild!; const card = sub.querySelector('[data-scratch-note]')!;
  box(card, 100, 100);
  const hits = jest.fn(() => [card, sub, point]); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  act(() => result.current.onDragStart(start()));
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: 'note-sub:s', data: { containerId: 'note-sub:s', index: 0 } }]);
  hits.mockReturnValue([point]);
  Object.defineProperty(scroller, 'scrollTop', { value: 40, configurable: true });
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
  expect(hits).toHaveBeenCalledTimes(2);
});

it('treats a scroll of a container itself, or two scrollers trading offsets, as a move', () => {
  fixture.innerHTML = '<div id="a"><div data-note-container="note-point:p"></div></div><div id="b"><div data-note-container="note-point:q"></div></div>';
  const a = fixture.querySelector('#a') as HTMLElement; const b = fixture.querySelector('#b') as HTMLElement; const p = a.firstElementChild as HTMLElement;
  const hits = jest.fn(() => [p]); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  act(() => result.current.onDragStart(start()));
  result.current.collisionDetection(collision({ x: 50, y: 120 }));
  Object.defineProperty(p, 'scrollTop', { value: 30, configurable: true });
  result.current.collisionDetection(collision({ x: 50, y: 120 }));
  expect(hits).toHaveBeenCalledTimes(2);
  Object.defineProperty(p, 'scrollTop', { value: 0, configurable: true });
  Object.defineProperty(a, 'scrollLeft', { value: 40, configurable: true });
  result.current.collisionDetection(collision({ x: 50, y: 120 }));
  Object.defineProperty(a, 'scrollLeft', { value: 0, configurable: true });
  Object.defineProperty(b, 'scrollLeft', { value: 40, configurable: true });
  result.current.collisionDetection(collision({ x: 50, y: 120 }));
  expect(hits).toHaveBeenCalledTimes(4);
});

it('does not hold on to "no target": a container that slides under a resting copy is found', () => {
  // A slot closing in the pool slides the point up under the still copy; nothing else in the key
  // changes. An empty answer opens nothing and moves nothing, so asking again cannot loop.
  fixture.innerHTML = '<div data-note-container="note-point:p"></div>';
  const point = fixture.firstElementChild!;
  const hits = jest.fn((): Element[] => []); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  act(() => result.current.onDragStart(start()));
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([]);
  hits.mockReturnValue([point]);
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
  hits.mockReturnValue([]);
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
});

it('files only into its own board, never into the page board seen through a dialog', () => {
  // The structure editor is a dialog over the page's own scratch board, with the same container ids.
  fixture.innerHTML = `<div id="page"><div data-note-container="note-point:p"><div data-scratch-strip="note-point:p"></div></div></div>`
    + `<div id="dialog"><div data-note-container="${NOTE_POOL_ID}"><div data-scratch-strip="${NOTE_POOL_ID}"></div></div></div>`;
  const pagePoint = fixture.querySelector('#page [data-note-container]')!; const dialogPool = fixture.querySelector('#dialog [data-note-container]')!;
  const hits = jest.fn(() => [dialogPool, pagePoint]); Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  result.current.boardRef.current = fixture.querySelector('#dialog') as HTMLDivElement;
  act(() => result.current.onDragStart(start()));
  expect(result.current.collisionDetection(collision({ x: 50, y: 120 }))).toEqual([{ id: NOTE_POOL_ID, data: { containerId: NOTE_POOL_ID, index: 0 } }]);
  hits.mockReturnValue([pagePoint]);
  expect(result.current.collisionDetection(collision({ x: 60, y: 130 }))).toEqual([]);
});

it('measures the place inside a container on its own board, not on the page board behind it', () => {
  // The page board comes first in the document and holds two cards above the pointer; the dialog's
  // pool holds none, so the note goes first there.
  fixture.innerHTML = `<div id="page"><div data-note-container="${NOTE_POOL_ID}"><div data-scratch-strip="${NOTE_POOL_ID}"><div data-scratch-note="a">A</div><div data-scratch-note="b">B</div></div></div></div>`
    + `<div id="dialog"><div data-note-container="${NOTE_POOL_ID}"><div data-scratch-strip="${NOTE_POOL_ID}"></div></div></div>`;
  fixture.querySelectorAll('#page [data-scratch-note]').forEach((card, i) => box(card, i * 50, 40));
  const dialogPool = fixture.querySelector('#dialog [data-note-container]')!;
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [dialogPool], configurable: true });
  const { result } = setup(layer());
  result.current.boardRef.current = fixture.querySelector('#dialog') as HTMLDivElement;
  act(() => result.current.onDragStart(start()));
  expect(result.current.collisionDetection(collision({ x: 50, y: 300 }))).toEqual([{ id: NOTE_POOL_ID, data: { containerId: NOTE_POOL_ID, index: 0 } }]);
});

it('measures an existing physical slot and ignores the hidden lifted node', () => {
  fixture.innerHTML = '<div data-note-container="note-point:p"><div data-scratch-strip="note-point:p"><div data-scratch-note="n" class="hidden"></div><div data-scratch-slot="target"></div><div data-scratch-note="other"></div></div></div>';
  const slot = fixture.querySelector('[data-scratch-slot]')!; box(slot, 100, 120); box(fixture.querySelector('[data-scratch-note="other"]')!, 220, 100);
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [slot], configurable: true });
  const { result } = setup(layer()); act(() => result.current.onDragStart(start()));
  expect(result.current.collisionDetection(collision({ x: 50, y: 140 }))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
});

// BUG-20260905-scratch-keyboard-drag-lifts-offscreen: the keyboard sensor measures the lifted card on
// every arrow press, and a card hidden with display:none measures as an empty box at the page corner,
// so the copy did not move. A keyboard lift leaves the card in place; a pointer lift still hides it.
it('aims a keyboard drag where its shifted copy is drawn, and still draws it by the handle', () => {
  // A clipped copy of a tall note flies shifted down by the height it lost, so its handle stays on
  // screen; with no pointer the drop must be decided at that copy, not at dnd-kit's bare rectangle.
  fixture.innerHTML = `<div data-note-container="note-point:p"></div><div data-note-container="${NOTE_POOL_ID}"><div data-scratch-strip="${NOTE_POOL_ID}"><div data-scratch-note="n"><article>Note</article></div></div></div>`;
  box(fixture.querySelector('[data-scratch-note="n"] article')!, 0, 300);
  const point = fixture.firstElementChild!;
  const hits = jest.fn((x: number, y: number) => (x === 50 && y === 230 ? [point] : []));
  Object.defineProperty(document, 'elementsFromPoint', { value: hits, configurable: true });
  const { result } = setup(layer());
  act(() => result.current.onDragStart({ active: { id: 'note:n' }, activatorEvent: new KeyboardEvent('keydown', { key: ' ' }) } as unknown as DragStartEvent));
  const overlay = document.createElement('div'); Object.defineProperty(overlay, 'offsetHeight', { value: 120 }); result.current.overlayCardRef.current = overlay;
  const args = { active: { id: 'note:n' }, transform: { x: 2, y: 10, scaleX: 1, scaleY: 1 } } as unknown as Parameters<Modifier>[0];
  expect(result.current.keepHandleUnderFinger(args)).toEqual({ ...args.transform, y: 190 });
  expect(result.current.collisionDetection(collision(null))).toEqual([{ id: 'note-point:p', data: { containerId: 'note-point:p', index: 0 } }]);
  expect(hits).toHaveBeenCalledWith(50, 230);
});

it('leaves the source card in place when a note is lifted from the keyboard', () => {
  const { result } = setup(layer());
  act(() => result.current.onDragStart({ active: { id: 'note:n' }, activatorEvent: new KeyboardEvent('keydown', { key: ' ' }) } as unknown as DragStartEvent));
  expect(result.current.activeDrag).toEqual(expect.objectContaining({ kind: 'note', id: 'n' }));
  expect(result.current.liftedNoteId).toBeNull();
  expect(result.current.keptNoteId).toBe('n');

  act(() => result.current.cancelDrag());
  expect(result.current.keptNoteId).toBeNull();
  act(() => result.current.onDragStart({ active: { id: 'note:n' }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent));
  expect(result.current.liftedNoteId).toBe('n');
});
