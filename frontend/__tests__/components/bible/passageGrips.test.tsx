import { act, fireEvent, render } from '@testing-library/react';

import { PassageGrips } from '@/components/bible/verseCopy/PassageGrips';

import type { VerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import type { BookText } from '@/utils/bibleText';

/*
 * THE GRIPS OF A CHOSEN PASSAGE (phase 9, the owner 01.11; Codex review r3): rows measured by hand — 1:1 at 0–40,
 * 1:2 at 40–100, 1:3 at 100–140, 1:4 at 140–180 — and the frames run by hand, so a pull is watched frame by frame.
 */
const text: BookText = { id: 'Ruth', chapters: [['one', 'two', 'three', 'four']] };
const ROWS: Record<number, [number, number]> = { 1: [0, 40], 2: [40, 100], 3: [100, 140], 4: [140, 180] };
const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200, width: 200, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;

let card: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let lastFrame = 0;
const realPointerEvent = window.PointerEvent;
/** jsdom has no PointerEvent: a mouse event that keeps the pointer's id, so two fingers are two pointers. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function drawRows(verses: number[], shift = () => 0) {
  card.innerHTML = verses.map((verse) => `<div data-verse="1:${verse}">${verse}</div>`).join('');
  card.querySelectorAll<HTMLElement>('[data-verse]').forEach((row) => {
    const [top, bottom] = ROWS[Number(row.dataset.verse!.split(':')[1])];
    row.getBoundingClientRect = () => rect(top - shift(), bottom - shift());
  });
}
const passageOf = (fromVerse: number, toVerse: number) => ({ chapter: 1, fromVerse, toChapter: 1, toVerse });
const copyOf = (passage: ReturnType<typeof passageOf> | null, moveEnd = jest.fn(), pullEnded = jest.fn()) => ({ passage, purpose: 'comment', moveEnd, pullEnded }) as unknown as VerseCopy;
const grips = (copy: VerseCopy) => <PassageGrips root={{ current: card }} copy={copy} text={text} />;
const grip = (end: 'first' | 'last') => document.querySelector<HTMLElement>(`[data-passage-grip="${end}"]`)!;
const runFrames = () => act(() => { const due = [...frames.values()]; frames.clear(); due.forEach((frame) => frame(0)); });

beforeEach(() => {
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  card = document.createElement('article');
  card.getBoundingClientRect = () => rect(0, 400);
  document.body.append(card);
  drawRows([1, 2, 3]);
  frames = new Map();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => { frames.set(++lastFrame, frame); return lastFrame; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  window.scrollBy = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
afterEach(() => {
  card.remove();
  jest.restoreAllMocks();
  window.PointerEvent = realPointerEvent;
});

describe('the grips of a chosen passage', () => {
  it('takes the next verse once the pointer is past its middle, the grip under the pointer meanwhile', () => {
    const copy = copyOf(passageOf(1, 1));
    render(grips(copy));
    expect(grip('last').style.top).toBe('46px');
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 60 });
    runFrames();
    expect(copy.moveEnd).not.toHaveBeenCalled();
    expect(grip('last').style.top).toBe('60px');
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 75 });
    runFrames();
    expect(copy.moveEnd).toHaveBeenLastCalledWith('last', { chapter: 1, verse: 2 });
    expect(grip('last').style.top).toBe('75px');
  });

  it('takes the verse where it was let go, before the frame came; a press with no move moves nothing', () => {
    const copy = copyOf(passageOf(1, 1));
    render(grips(copy));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerUp(grip('last'), { pointerId: 1, clientY: 46 });
    expect(copy.moveEnd).not.toHaveBeenCalled();
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 75 });
    fireEvent.pointerUp(grip('last'), { pointerId: 1, clientY: 75 });
    expect(copy.moveEnd).toHaveBeenLastCalledWith('last', { chapter: 1, verse: 2 });
    expect(frames.size).toBe(0);
    // The click the browser may send after the lift is the pull's: the picker hears that the pull ended (owner, 01.11, iPad).
    expect(copy.pullEnded).toHaveBeenCalledTimes(2);
    expect(copy.pullEnded).toHaveBeenLastCalledWith(1);
    // A pull the browser broke off sends no click after it.
    fireEvent.pointerDown(grip('last'), { pointerId: 4, clientY: 46 });
    fireEvent.pointerCancel(grip('last'), { pointerId: 4, clientY: 46 });
    expect(copy.pullEnded).toHaveBeenLastCalledWith(null);
  });

  it('ends a pull when the choice is let go: the next choice moves only under a new press', () => {
    const copy = copyOf(passageOf(1, 1));
    const view = render(grips(copy));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 30 });
    runFrames();
    view.rerender(grips(copyOf(null)));
    view.rerender(grips(copy));
    expect(grip('last').style.top).toBe('46px');
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 75 });
    runFrames();
    expect(copy.moveEnd).not.toHaveBeenCalled();
  });

  it('leaves no frame behind when the grips go mid-pull', () => {
    const view = render(grips(copyOf(passageOf(1, 1))));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 75 });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it('pulls one grip at a time: a second finger on the other grip does not take the first one\'s end', () => {
    const copy = copyOf(passageOf(1, 3));
    render(grips(copy));
    fireEvent.pointerDown(grip('first'), { pointerId: 1, clientY: -6 });
    fireEvent.pointerDown(grip('last'), { pointerId: 2, clientY: 146 });
    fireEvent.pointerMove(grip('last'), { pointerId: 2, clientY: 30 });
    runFrames();
    fireEvent.pointerMove(grip('first'), { pointerId: 1, clientY: 75 });
    runFrames();
    expect(copy.moveEnd).toHaveBeenCalledTimes(1);
    expect(copy.moveEnd).toHaveBeenCalledWith('first', { chapter: 1, verse: 3 });
  });

  it('keeps scrolling the text under a finger held at the edge, the grip staying under it', () => {
    const pane = document.createElement('div');
    pane.className = 'overflow-y-auto';
    pane.getBoundingClientRect = () => rect(0, 200);
    document.body.append(pane);
    pane.append(card);
    card.getBoundingClientRect = () => rect(-pane.scrollTop, 400 - pane.scrollTop);
    drawRows([1, 2, 3], () => pane.scrollTop);
    render(grips(copyOf(passageOf(1, 1))));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 199 });
    runFrames();
    expect(pane.scrollTop).toBe(14);
    expect(Number.parseFloat(grip('last').style.top) + card.getBoundingClientRect().top).toBe(199);
    runFrames();
    expect(pane.scrollTop).toBe(28);
    pane.remove();
  });

  it('stops scrolling at the text\'s end, the finger still held there', () => {
    const pane = document.createElement('div');
    pane.className = 'overflow-y-auto';
    pane.getBoundingClientRect = () => rect(0, 200);
    let top = 0;
    Object.defineProperty(pane, 'scrollTop', { get: () => top, set: (value: number) => { top = Math.min(14, Math.max(0, value)); } });
    document.body.append(pane);
    pane.append(card);
    render(grips(copyOf(passageOf(1, 1))));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 199 });
    runFrames();
    expect(top).toBe(14);
    runFrames();
    expect(frames.size).toBe(0);
    pane.remove();
  });

  it('ends a pull let go away from its grip — the grip gone meanwhile, its verse no longer drawn', () => {
    const copy = copyOf(passageOf(1, 1));
    const view = render(<PassageGrips root={{ current: card }} copy={copy} text={text} drawn={1} />);
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    drawRows([2, 3]);
    view.rerender(<PassageGrips root={{ current: card }} copy={copy} text={text} drawn={2} />);
    expect(document.querySelector('[data-passage-grip="last"]')).toBeNull();
    fireEvent.pointerUp(document.body, { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientY: 75 });
    runFrames();
    expect(copy.moveEnd).not.toHaveBeenCalled();
  });

  it('takes its listeners off the window when a pull ends, and when the grips go mid-pull', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const pullTypes = (spy: jest.SpyInstance) => spy.mock.calls.map(([type]) => type).filter((type) => String(type).startsWith('pointer')).sort();
    const view = render(grips(copyOf(passageOf(1, 1))));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    expect(pullTypes(add)).toEqual(['pointercancel', 'pointermove', 'pointerup']);
    fireEvent.pointerUp(grip('last'), { pointerId: 1, clientY: 46 });
    expect(pullTypes(remove)).toEqual(['pointercancel', 'pointermove', 'pointerup']);
    fireEvent.pointerDown(grip('last'), { pointerId: 2, clientY: 46 });
    view.unmount();
    expect(pullTypes(remove)).toEqual(['pointercancel', 'pointercancel', 'pointermove', 'pointermove', 'pointerup', 'pointerup']);
  });

  it('works each frame with the passage as it is now, not as the pull found it', () => {
    const pane = document.createElement('div');
    pane.className = 'overflow-y-auto';
    pane.getBoundingClientRect = () => rect(0, 200);
    document.body.append(pane);
    pane.append(card);
    card.getBoundingClientRect = () => rect(-pane.scrollTop, 400 - pane.scrollTop);
    drawRows([1, 2, 3], () => pane.scrollTop);
    const moveEnd = jest.fn();
    const view = render(grips(copyOf(passageOf(1, 1), moveEnd)));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 46 });
    fireEvent.pointerMove(grip('last'), { pointerId: 1, clientY: 199 });
    runFrames();
    expect(moveEnd).toHaveBeenLastCalledWith('last', { chapter: 1, verse: 3 });
    view.rerender(grips(copyOf(passageOf(1, 3), moveEnd)));
    runFrames();
    expect(moveEnd).toHaveBeenCalledTimes(1);
    pane.remove();
  });

  it('takes the focus when pressed, and the arrows move an end to a verse on screen only', () => {
    const copy = copyOf(passageOf(1, 2));
    render(grips(copy));
    fireEvent.pointerDown(grip('last'), { pointerId: 1, clientY: 106 });
    fireEvent.pointerUp(grip('last'), { pointerId: 1, clientY: 106 });
    expect(document.activeElement).toBe(grip('last'));
    fireEvent.keyDown(grip('last'), { key: 'ArrowDown' });
    expect(copy.moveEnd).toHaveBeenLastCalledWith('last', { chapter: 1, verse: 3 }, 'arrow');
    const atThree = copyOf(passageOf(1, 3));
    render(grips(atThree), { container: document.body.appendChild(document.createElement('div')) });
    const last = document.querySelectorAll<HTMLElement>('[data-passage-grip="last"]')[1];
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(atThree.moveEnd).not.toHaveBeenCalled();
  });
});
