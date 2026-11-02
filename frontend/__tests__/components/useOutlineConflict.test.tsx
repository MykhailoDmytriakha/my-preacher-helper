import { act, renderHook } from '@testing-library/react';

import { useOutlineConflict } from '@/components/plan-editor/useOutlineConflict';
import { findDraftCopies } from '@/utils/durableDraft';

import type { OutlineConflictRecord } from '@/components/plan-editor/useOutlineConflict';

const outline = (text: string) => ({ introduction: [], main: [{ id: 'p1', text }], conclusion: [] });
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('retires an exact selected local snapshot captured before React redraws', () => {
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  act(() => { view.result.current.ask(outline('Refused words'), outline('Old'), outline('Server')); });
  let captured: OutlineConflictRecord | null = null;
  act(() => {
    view.result.current.select(outline('Chosen words'), outline('Server'));
    captured = view.result.current.get();
  });
  act(() => { view.result.current.retire(captured); });
  expect(view.result.current.record).toBeNull();
  expect(findDraftCopies('owner', 'sermon', 'conflict:outlineConflict')).toEqual([]);
  view.unmount();
});

it('retains later outline words when an earlier selected snapshot is captured', () => {
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  act(() => { view.result.current.ask(outline('Refused words'), outline('Old'), outline('Server')); });
  let captured: OutlineConflictRecord | null = null;
  act(() => {
    view.result.current.select(outline('Chosen words'), outline('Server'));
    captured = view.result.current.get();
  });
  act(() => { view.result.current.edit(outline('Later words')); });
  act(() => { view.result.current.retire(captured); });
  expect(view.result.current.record?.payload.outline.main[0].text).toBe('Later words');
  expect(findDraftCopies<{ payload: { outline: ReturnType<typeof outline> } }>('owner', 'sermon', 'conflict:outlineConflict')
    .map(copy => copy.value.payload.outline.main[0].text)).toEqual(['Later words']);
  view.unmount();
});


it('retires the captured selected copy while another independent refusal remains current', () => {
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  act(() => { view.result.current.ask(outline('First words'), outline('Old'), outline('Server')); });
  let captured: OutlineConflictRecord | null = null;
  act(() => {
    view.result.current.select(outline('Chosen first words'), outline('Server'));
    captured = view.result.current.get();
  });
  act(() => { view.result.current.ask(outline('Independent second words'), outline('Old'), outline('Server')); });
  act(() => { view.result.current.retire(captured); });
  expect(view.result.current.record?.payload.outline.main[0].text).toBe('Independent second words');
  expect(findDraftCopies<{ payload: { outline: ReturnType<typeof outline> } }>('owner', 'sermon', 'conflict:outlineConflict')
    .map(copy => copy.value.payload.outline.main[0].text)).toEqual(['Independent second words']);
  view.unmount();
});


it('retains a new refusal without replacing an open editor that has no selected copy', () => {
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  let release!: () => void;
  act(() => { release = view.result.current.holdSelection(); });
  act(() => { view.result.current.retain(outline('Earlier refused words'), outline('Old'), outline('Server')); });
  expect(view.result.current.record).toBeNull();
  expect(view.result.current.choices.copies).toHaveLength(1);
  expect(view.result.current.editing).toBe(true);
  act(() => { release();release(); });
  expect(view.result.current.record?.payload.outline.main[0].text).toBe('Earlier refused words');
  expect(view.result.current.editing).toBe(false);
  view.unmount();
});

it('does not jump to an independent copy when the open editor resolves its selected refusal', () => {
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  act(() => { view.result.current.ask(outline('Current question'), outline('Old'), outline('Server')); });
  let release!: () => void;
  act(() => { release = view.result.current.holdSelection(); });
  act(() => { view.result.current.retain(outline('Independent question'), outline('Old'), outline('Server')); });
  expect(view.result.current.record?.payload.outline.main[0].text).toBe('Current question');
  act(() => { view.result.current.clear(); });
  expect(view.result.current.record).toBeNull();
  expect(view.result.current.choices.copies).toHaveLength(1);
  act(() => { release(); });
  expect(view.result.current.record?.payload.outline.main[0].text).toBe('Independent question');
  view.unmount();
});

it('keeps a selected pending answer when a later independent refusal arrives before closing', () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const view = renderHook(() => useOutlineConflict('owner', 'sermon'));
  try {
    act(() => { view.result.current.ask(outline('Question'), outline('Old'), outline('Server')); });
    let release!: () => void;
    act(() => { release = view.result.current.holdSelection();view.result.current.select(outline('Pending chosen words'), outline('Server')); });
    const selected = view.result.current.choices.selectedKey;
    clock.mockReturnValue(2000);
    act(() => { view.result.current.retain(outline('Later independent question'), outline('Old'), outline('Server')); });
    act(() => { release(); });
    expect(view.result.current.choices.selectedKey).toBe(selected);
    expect(view.result.current.record?.payload).toMatchObject({ resolution: 'local', outline: outline('Pending chosen words') });
    expect(view.result.current.choices.copies).toHaveLength(2);
  } finally { view.unmount();clock.mockRestore(); }
});

it('keeps a departed refusal in its original owner and document without changing the new view', () => {
  const view = renderHook(({ owner, id }) => useOutlineConflict(owner, id), { initialProps: { owner: 'first-owner', id: 'first-sermon' } });
  const retain = view.result.current.retain;
  view.rerender({ owner: 'second-owner', id: 'second-sermon' });
  act(() => { retain(outline('Departed words'), outline('Old'), outline('Server')); });
  expect(view.result.current.record).toBeNull();
  expect(findDraftCopies('first-owner', 'first-sermon', 'conflict:outlineConflict')).toHaveLength(1);
  expect(findDraftCopies('second-owner', 'second-sermon', 'conflict:outlineConflict')).toEqual([]);
  view.unmount();
});
