import { act, renderHook } from '@testing-library/react';

import { resetSearchHistoryForTests } from '@/components/bible/searchHistoryStore';
import { useSearchKeeping } from '@/components/bible/search/useSearchKeeping';

import type { SearchToKeep } from '@/components/bible/search/searchKeeping';

/*
 * The history keeping the search shown (the owner, 2026-10-27; Codex review): a search taken out of the history while
 * its books still come stays out, and a search read anew starts its clock again.
 */
const kept = () => (JSON.parse(window.localStorage.getItem('bible:search-history') ?? '{"entries":[]}') as { entries: Array<{ line: string }> }).entries.map((entry) => entry.line);
const search = (line: string, meaning = 'bible'): SearchToKeep => ({ line, asWords: false, byRest: true, meaning });
type Props = { keep: SearchToKeep | null; line: string };

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  resetSearchHistoryForTests();
});
afterEach(() => jest.useRealTimers());

const render = (initial: Props) => renderHook(({ keep, line }: Props) => useSearchKeeping(keep, 'rst', true, line), { initialProps: initial });

it('a search taken out of the history before its verses came is not kept back when they come', () => {
  const { result, rerender } = render({ keep: null, line: 'хлеб жизни' });
  act(() => result.current.forgetEntry({ line: 'хлеб жизни', bible: 'rst', at: 1 }));
  rerender({ keep: search('хлеб жизни'), line: 'хлеб жизни' });
  act(() => { jest.advanceTimersByTime(15000); });
  expect(kept()).toEqual([]);
  // A new act keeps it again.
  act(() => result.current.keepShown());
  expect(kept()).toEqual(['хлеб жизни']);
});

it('a search read anew — a book arrived and changed what it searches — starts its clock again', () => {
  const { rerender } = render({ keep: search('корин крис*', 'bible'), line: 'корин крис*' });
  act(() => { jest.advanceTimersByTime(9000); });
  rerender({ keep: search('корин крис*', 'corinthians'), line: 'корин крис*' });
  act(() => { jest.advanceTimersByTime(2000); });
  expect(kept()).toEqual([]);
  act(() => { jest.advanceTimersByTime(8500); });
  expect(kept()).toEqual(['корин крис*']);
});

// Codex review r3, 2026-10-27: the person's acts hold by the field, not by what the line came to mean.
it('a refusal holds while the field stands, though the layout turned or a book arrived changes what it reads', () => {
  const { result, rerender } = render({ keep: null, line: '[kt, ;bpyb' });
  act(() => result.current.declineAll());
  rerender({ keep: search('хлеб жизни'), line: '[kt, ;bpyb' });
  act(() => { jest.advanceTimersByTime(15000); });
  expect(kept()).toEqual([]);
  // The turned entry taken out before its verses came stays out too.
  const other = render({ keep: null, line: '[kt, ;bpyb' });
  act(() => other.result.current.forgetEntry({ line: 'хлеб жизни', bible: 'rst', at: 1 }));
  other.rerender({ keep: search('хлеб жизни'), line: '[kt, ;bpyb' });
  act(() => { jest.advanceTimersByTime(15000); });
  expect(kept()).toEqual([]);
});

it('a search a press set off waits for its own answer through the books still coming; a clear lets it go', () => {
  const { result, rerender } = render({ keep: null, line: 'Рим 40 вера' });
  act(() => result.current.launched('Рим вера', false, 'Рим вера'));
  rerender({ keep: null, line: 'Рим вера' });
  rerender({ keep: search('Рим вера'), line: 'Рим вера' });
  expect(kept()).toEqual(['Рим вера']);

  window.localStorage.clear();
  resetSearchHistoryForTests();
  const second = render({ keep: null, line: 'Рим 40 вера' });
  act(() => second.result.current.launched('Рим вера', false, 'Рим вера'));
  second.rerender({ keep: null, line: 'Рим вера' });
  act(() => second.result.current.declineAll());
  second.rerender({ keep: search('Рим вера'), line: 'Рим вера' });
  act(() => { jest.advanceTimersByTime(15000); });
  expect(kept()).toEqual([]);
});

