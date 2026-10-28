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
