import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { leaveAnalysisAddress } from '@/components/bible/analysis/analysisAddress';
import { useAnalysisAddress } from '@/components/bible/analysis/useAnalysisAddress';
import { historyStepHere } from '@/utils/historyStep';

import type { AnalysisMode } from '@/components/bible/analysis/AnalysisParts';
import type { AnalysisOpening } from '@/components/bible/analysis/useAnalysisNote';

/*
 * The owner, 03.11: «Когда я открыл разборы, а потом нажал кнопку назад … открылась Библия, а не разбор. А оно должно
 * запоминать, откуда я пришел». An analysis screen opened over the page is one step in history: Back closes it, and the page
 * stands as it was; closed by its own way back it takes the step again.
 */
const LIST = '/studies?tab=analyses';
const opened: AnalysisOpening = { kind: 'open', id: 'a1', editing: false };

type Props = { opening: AnalysisOpening; id: string | null; mode: AnalysisMode; onBack: () => void };
const screenAt = (props: Props) => renderHook((p: Props) => useAnalysisAddress({ ...p, gone: false, onGone: jest.fn() }), { initialProps: props });
const here = () => `${window.location.pathname}${window.location.search}`;
const back = async () => {
  const before = here();
  act(() => window.history.back());
  await waitFor(() => expect(here()).not.toBe(before));
};
/** The screen gone: its step is taken a moment after, once a navigation away would have moved the address off it. */
const unmountAndSettle = async (unmount: () => void) => {
  unmount();
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
};

describe('the analysis screen — one step in the browser\'s history', () => {
  beforeEach(() => window.history.pushState(null, '', LIST));
  // A screen a test leaves mounted is unmounted by the cleanup and takes its step a moment later: that, and the browser's
  // move it starts, end here — not inside the next test (the build machine, 04.11).
  afterEach(async () => {
    cleanup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  });

  it('a screen\'s late cleanup leaves alone the entry another screen of the same analysis stands on', async () => {
    // The build machine, 04.11: one screen's cleanup came late, while a new screen of the same analysis stood on its own
    // step; seeing the address name the analysis it took the entry for its own and rewrote it to the list's address.
    const first = screenAt({ opening: opened, id: 'a1', mode: 'edit', onBack: jest.fn() });
    first.unmount();
    window.history.pushState(null, '', '/bible');
    window.history.pushState(null, '', LIST);
    screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    const second = historyStepHere();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(window.location.search).toBe('?tab=analyses&analysis=a1&mode=view');
    expect(historyStepHere()).toBe(second);
  });

  it('opened over the list, adds one entry naming the analysis; Back closes it and lands on the list', async () => {
    const length = window.history.length;
    const onBack = jest.fn();
    screenAt({ opening: opened, id: 'a1', mode: 'view', onBack });
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search).toContain('analysis=a1');
    expect(historyStepHere()).not.toBeNull();
    await back();
    expect(here()).toBe(LIST);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('left by a jump in the browser\'s own history to another entry naming the same analysis, stays on that entry', async () => {
    // Codex, 04.11: the reader's analysis A → «Все разборы» → A opened over the list → the reader's entry picked from Back's
    // list. The closing screen took that entry's step for its own and went back once more, past where the person chose.
    const READER = '/bible?book=ephesians&at=1:3&analysis=a1&mode=view';
    window.history.pushState({ screenStep: 'reader-step' }, '', READER);
    window.history.pushState(null, '', LIST);
    // The host closes it on Back as its own way back does: the analysis left, its step taken if the entry is its.
    const { unmount } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: () => leaveAnalysisAddress('a1') });
    act(() => window.history.go(-2));
    await waitFor(() => expect(here()).toBe(READER));
    await unmountAndSettle(unmount);
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(here()).toBe(READER);
    expect(historyStepHere()).toBe('reader-step');
  });

  it('a change of mode stays on the same entry', () => {
    const length = window.history.length;
    const { rerender } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    rerender({ opening: opened, id: 'a1', mode: 'edit', onBack: jest.fn() });
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search).toContain('mode=edit');
  });

  it('closed by its own way back, takes its step: the list is where Back led before the screen opened', async () => {
    window.history.pushState(null, '', '/bible');
    window.history.pushState(null, '', LIST);
    const { unmount } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    await unmountAndSettle(unmount);
    await waitFor(() => expect(here()).toBe(LIST));
    expect(historyStepHere()).toBeNull();
    await back();
    expect(here()).toBe('/bible');
  });

  it('arrived at by an address (a link, a redirect) adds no entry, and closing forgets the analysis in place', async () => {
    window.history.replaceState(null, '', `${LIST}&analysis=a1&mode=view`);
    const length = window.history.length;
    const { unmount } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    expect(window.history.length).toBe(length);
    await unmountAndSettle(unmount);
    expect(here()).toBe(LIST);
    expect(window.history.length).toBe(length);
  });

  it('reopened on its own step after a reload, closing still takes that step', async () => {
    window.history.pushState({ screenStep: 'before-reload' }, '', `${LIST}&analysis=a1&mode=view`);
    const length = window.history.length;
    const { unmount } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    expect(window.history.length).toBe(length);
    await unmountAndSettle(unmount);
    await waitFor(() => expect(here()).toBe(LIST));
  });

  it('a new analysis is a step before it has a note, and names its note on that same step once it has one', async () => {
    const length = window.history.length;
    const onBack = jest.fn();
    const fresh: AnalysisOpening = { kind: 'new', passage: { chapter: 1, fromVerse: 3, toChapter: 1, toVerse: 14 } } as AnalysisOpening;
    const { rerender } = screenAt({ opening: fresh, id: null, mode: 'edit', onBack });
    expect(window.history.length).toBe(length + 1);
    expect(here()).toBe(LIST);
    rerender({ opening: fresh, id: 'n1', mode: 'edit', onBack });
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search).toContain('analysis=n1');
    await back();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('gone a moment ago, leaves alone the entry the person has moved on to — another page naming another analysis', async () => {
    const { unmount } = screenAt({ opening: opened, id: 'a1', mode: 'view', onBack: jest.fn() });
    unmount();
    window.history.pushState(null, '', '/bible?book=ephesians&analysis=b9&mode=view');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(here()).toBe('/bible?book=ephesians&analysis=b9&mode=view');
  });
});
