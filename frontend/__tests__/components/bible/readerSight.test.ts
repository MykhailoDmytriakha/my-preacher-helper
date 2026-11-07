import { act, renderHook } from '@testing-library/react';

import { sightShift, touchedVerse, useChosenVerseInSight } from '@/components/bible/readerSight';

// Visual pass 2026-11-07, live on a 390 px phone: a verse held at 694–788 px went under the bar of the verses chosen (its top
// at 652 px), and a paragraph written on the verse at the top got its heading under the header.
describe('how far the text moves so a thing is seen', () => {
  const room = { top: 64, bottom: 652 };

  it('leaves a thing already in the room where it is', () => {
    expect(sightShift({ top: 300, bottom: 360 }, room)).toBe(0);
  });

  it('brings a verse under the bar up above it, with air', () => {
    expect(sightShift({ top: 694, bottom: 788 }, room)).toBe(788 - 652 + 12);
  });

  it('brings a heading under the header down below it, with air', () => {
    expect(sightShift({ top: 43, bottom: 69 }, room)).toBe(43 - 64 - 12);
  });

  it('shows the start of a thing taller than the room, never pushing its top out', () => {
    expect(sightShift({ top: 400, bottom: 1400 }, room)).toBe(400 - 64 - 12);
  });

  it('moves nothing for a thing at the very top that runs past the bottom', () => {
    expect(sightShift({ top: 70, bottom: 900 }, room)).toBe(0);
  });
});

describe('the verse just pressed or held', () => {
  const at = (chapter: number, verse: number) => ({ chapter, verse });

  it('is the one that started the choice', () => {
    expect(touchedVerse(null, [at(3, 24)])).toEqual(at(3, 24));
  });

  it('is the one a press added', () => {
    expect(touchedVerse([at(3, 18)], [at(3, 18), at(3, 20)])).toEqual(at(3, 20));
  });

  it('is the far end of a hold below the choice', () => {
    expect(touchedVerse([at(3, 18)], [at(3, 18), at(3, 19), at(3, 20), at(3, 21)])).toEqual(at(3, 21));
  });

  it('is the far end of a hold above the choice, across a chapter', () => {
    expect(touchedVerse([at(3, 2)], [at(3, 2), at(2, 22), at(2, 23), at(3, 1)])).toEqual(at(2, 22));
  });

  it('is none when a verse was let go or the choice ended', () => {
    expect(touchedVerse([at(3, 18), at(3, 20)], [at(3, 18)])).toBeNull();
    expect(touchedVerse([at(3, 18)], null)).toBeNull();
  });
});

// Codex review of the visual pass, 2026-11-07: a finger resting on the text while the Pencil held a verse — the Pencil
// lifted, the text slid 202 px under the finger. The text moves once no pointer is down, and 120 ms after the last lift.
describe('the verse just chosen, kept above the bar', () => {
  const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  const pointer = (type: string, pointerId: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    window.dispatchEvent(event);
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

  it('moves the text only after every pointer is lifted, and only as far as the bar needs', () => {
    const article = document.createElement('article');
    const row = document.createElement('div');
    row.setAttribute('data-verse', '3:24');
    row.getBoundingClientRect = () => box(694, 788);
    article.append(row);
    const bar = document.createElement('div');
    bar.setAttribute('data-verse-bar', '');
    bar.getBoundingClientRect = () => box(652, 832);
    document.body.append(article, bar);
    const scrollTo = jest.fn();
    const surface = { target: window, top: () => 1000, scrollTo, height: () => 844, contentHeight: () => 5000, edge: () => 0, bottom: () => 844, anchoring: () => undefined };
    const props = { textRef: { current: article }, surfaceRef: { current: surface }, readingInsetRef: { current: 64 } };

    const { rerender } = renderHook(({ picked }) => useChosenVerseInSight({ picked, ...props }), { initialProps: { picked: null as { chapter: number; verse: number }[] | null } });
    pointer('pointerdown', 1); // the finger resting on the text
    pointer('pointerdown', 2); // the Pencil holding the verse
    rerender({ picked: [{ chapter: 3, verse: 24 }] });
    pointer('pointerup', 2);
    act(() => { jest.advanceTimersByTime(500); });
    expect(scrollTo).not.toHaveBeenCalled();
    pointer('pointerup', 1);
    act(() => { jest.advanceTimersByTime(100); });
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(30); });
    expect(scrollTo).toHaveBeenCalledWith(1000 + (788 - 652 + 12));
  });
});
