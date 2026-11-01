import { act, renderHook } from '@testing-library/react';

import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { diagnosticEvents } from '@/utils/appDiagnostics';

import type { BookText } from '@/utils/bibleText';

/*
 * THE CLICK AFTER A PULL (the owner, 01.11, iPad, Apple Pencil): the last grip pulled down and lifted — the first verse
 * came off. His technical report: «pull-last», then 39 ms later a «press» that moved the first verse later. Safari sends
 * a click after the lift onto a verse, naming another pointer. That click is the pull's: the first click on the text
 * after it, before any new press or key there; nothing about the click itself decides.
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
  now += 10;
  act(() => view.result.current.pullStarted());
  act(() => view.result.current.moveEnd('last', v(5)));
  act(() => view.result.current.moveEnd('last', v(6)));
  act(() => view.result.current.pullEnded(true));
  return view;
}

describe('the click a grip\'s pull sends after the lift', () => {
  it('is the first click on the text after it, taken once', () => {
    const { result } = pulledToSix();
    now += 39;
    expect(result.current.takesPullClick(true)).toBe(true);
    expect(result.current.takesPullClick(true)).toBe(false);
  });

  it('is not a click after a new press or key, nor after the choice began again, nor after half a second', () => {
    const { result } = pulledToSix();
    act(() => result.current.forgetPullClick());
    expect(result.current.takesPullClick(true)).toBe(false);
    const again = pulledToSix().result;
    act(() => again.current.startPassage(v(3), undefined, 'comment'));
    expect(again.current.takesPullClick(true)).toBe(false);
    const late = pulledToSix().result;
    now += 600;
    expect(late.current.takesPullClick(true)).toBe(false);
  });

  it('is not awaited when the text was pressed while the grip was held: that press clicks after the lift itself', () => {
    const view = picker();
    act(() => view.result.current.startPassage(v(3), undefined, 'comment'));
    now += 10;
    act(() => view.result.current.pullStarted());
    act(() => view.result.current.moveEnd('last', v(6)));
    now += 10;
    act(() => view.result.current.forgetPullClick());
    act(() => view.result.current.pullEnded(true));
    expect(view.result.current.takesPullClick(true)).toBe(false);
  });

  it('waits for no click after a pull the browser broke off', () => {
    const view = picker();
    act(() => view.result.current.startPassage(v(3), undefined, 'comment'));
    act(() => view.result.current.pullStarted());
    act(() => view.result.current.moveEnd('last', v(6)));
    act(() => view.result.current.pullEnded(false));
    expect(view.result.current.takesPullClick(true)).toBe(false);
  });

  it('puts one line per pull into the technical report — not one a step — and one for a click it took, never which verses', () => {
    // The report keeps its events in memory too, across tests: count what this test adds.
    const picksNow = () => diagnosticEvents().filter((event) => event.name === 'verse-pick').map((event) => event.data);
    const before = picksNow().length;
    const { result } = pulledToSix();
    expect(picksNow().length - before).toBe(1);
    now += 39;
    result.current.takesPullClick(true);
    expect(picksNow().length - before).toBe(2);
    expect(picksNow().slice(-2)).toEqual([
      expect.objectContaining({ source: 'pull-last', result: 'first-same-last-later' }),
      expect.objectContaining({ source: 'click', result: 'taken-by-pull', elapsedMs: 39 }),
    ]);
  });
});
