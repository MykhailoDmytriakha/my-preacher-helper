import { act, renderHook } from '@testing-library/react';

import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { diagnosticEvents } from '@/utils/appDiagnostics';

import type { BookText } from '@/utils/bibleText';

/*
 * THE CLICK AFTER A PULL (the owner, 01.11, iPad): turning a comment on one verse into a paragraph, the last grip pulled
 * down and the finger lifted — the first verse came off. Safari may send a click after the lift onto a verse, and for a
 * passage a press on an end verse takes it off. That click is the pull's: taken once, by the pull's pointer, within a
 * second; another pointer's click and the keyboard are presses of their own (Codex review, 01.11).
 */
const book: BookText = { id: 'Ruth', chapters: [['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']] };
const v = (verse: number) => ({ chapter: 1, verse });

let now = 1000;
beforeEach(() => {
  now = 1000;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  localStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

const picker = () => renderHook(() => useVerseCopy({ textRef: { current: document.createElement('article') }, text: book, bible: 'rst', bookId: 'Ruth', enabled: true }));
function pulledToSix() {
  const view = picker();
  act(() => view.result.current.startPassage(v(3), undefined, 'comment'));
  act(() => view.result.current.moveEnd('last', v(5)));
  act(() => view.result.current.moveEnd('last', v(6)));
  act(() => view.result.current.pullEnded(2));
  return view;
}

describe('the click a grip\'s pull sends after the lift', () => {
  it('is taken once, by the pull\'s own pointer or a click that names none', () => {
    const { result } = pulledToSix();
    now += 40;
    expect(result.current.takesPullClick({ pointerId: 2 }, true)).toBe(true);
    expect(result.current.takesPullClick({ pointerId: 2 }, true)).toBe(false);
    const other = pulledToSix().result;
    expect(other.current.takesPullClick({}, true)).toBe(true);
  });

  it('is not another pointer\'s click, nor one after a new press, nor after the choice began again, nor after three seconds', () => {
    const { result } = pulledToSix();
    expect(result.current.takesPullClick({ pointerId: 5 }, true)).toBe(false);
    act(() => result.current.forgetPullClick());
    expect(result.current.takesPullClick({ pointerId: 2 }, true)).toBe(false);
    const again = pulledToSix().result;
    act(() => again.current.startPassage(v(3), undefined, 'comment'));
    expect(again.current.takesPullClick({ pointerId: 2 }, true)).toBe(false);
    const late = pulledToSix().result;
    now += 3100;
    expect(late.current.takesPullClick({ pointerId: 2 }, true)).toBe(false);
  });

  it('waits for no click after a pull the browser broke off', () => {
    const view = picker();
    act(() => view.result.current.startPassage(v(3), undefined, 'comment'));
    act(() => view.result.current.moveEnd('last', v(6)));
    act(() => view.result.current.pullEnded(null));
    expect(view.result.current.takesPullClick({}, true)).toBe(false);
  });

  it('leaves the keyboard alone: a verse chosen by its key right after a pull still acts', () => {
    const { result } = pulledToSix();
    act(() => result.current.toggle(v(3)));
    expect(result.current.picked).toEqual([v(4), v(5), v(6)]);
  });

  it('puts one line per pull into the technical report — not one a step — and one for a click it took, never which verses', () => {
    // The report keeps its events in memory too, across tests: count what this test adds.
    const picksNow = () => diagnosticEvents().filter((event) => event.name === 'verse-pick').map((event) => event.data);
    const before = picksNow().length;
    const { result } = pulledToSix();
    expect(picksNow().length - before).toBe(1);
    now += 40;
    result.current.takesPullClick({ pointerId: 2 }, true);
    expect(picksNow().length - before).toBe(2);
    const picks = picksNow().slice(-2);
    expect(picks).toEqual([
      expect.objectContaining({ source: 'pull-last', result: 'first-same-last-later' }),
      expect.objectContaining({ source: 'click', result: 'taken-by-pull', elapsedMs: 40 }),
    ]);
  });
});
