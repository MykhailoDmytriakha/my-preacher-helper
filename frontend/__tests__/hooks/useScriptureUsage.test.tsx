import { renderHook } from '@testing-library/react';

import { useScriptureUsage } from '@/hooks/useScriptureUsage';

const reference = { bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16 };
const note = { resource: { collection: 'studyNotes', id: 'other' }, metadata: null,
  value: { userId: 'owner', title: 'Known related note', content: 'Kept words. John 3:16.',
    scriptureRefs: [{ ...reference, id: 'ref' }], tags: [], isDraft: false } };
const state = () => ({ snapshots: [note], documents: [note], complete: true,
  freshness: 'server' as 'unknown' | 'cache' | 'server', checking: false, version: 1, error: null as string | null });
let mockState = state();
let mockOnline = true;
let mockError: string | null = null;
const mockRefresh = jest.fn();
jest.mock('@/data-engine/react.client', () => ({ useDataCollection: () => ({ state: mockState, loading: false, error: mockError, refresh: mockRefresh }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

beforeEach(() => { mockState = state(); mockOnline = true; mockError = null; mockRefresh.mockClear(); });
const useUsage = () => useScriptureUsage(reference, 'current', 'en');

describe('personal-note list completeness', () => {
  it('keeps a confirmed list complete while its next server check is in progress', () => {
    const view = renderHook(useUsage);
    expect(view.result.current.complete).toBe(true);
    expect(view.result.current.results.map(item => item.id)).toEqual(['other']);
    mockState = { ...mockState, freshness: 'cache', checking: true };
    view.rerender();
    expect(view.result.current.complete).toBe(true);
    expect(view.result.current.results.map(item => item.id)).toEqual(['other']);
  });

  it('recognizes a complete saved list before the new check starts', () => {
    mockState = { ...mockState, freshness: 'cache' };
    expect(renderHook(useUsage).result.current.complete).toBe(true);
  });

  it('keeps a previously complete empty list distinct from a partial list', () => {
    mockState = { ...mockState, snapshots: [], documents: [], freshness: 'cache', checking: true };
    const { result } = renderHook(useUsage);
    expect(result.current.results).toEqual([]);
    expect(result.current.complete).toBe(true);
  });

  it('still identifies a genuinely partial list', () => {
    mockState = { ...mockState, complete: false, freshness: 'cache', checking: true };
    const { result } = renderHook(useUsage);
    expect(result.current.complete).toBe(false);
    expect(result.current.results).toHaveLength(1);
  });

  it('keeps available matches and the failure when the next read actually fails', () => {
    mockState = { ...mockState, freshness: 'cache', error: 'unavailable' };
    mockError = 'Notes could not be loaded';
    const { result } = renderHook(useUsage);
    expect(result.current.complete).toBe(false);
    expect(result.current.error).toBe(true);
    expect(result.current.results).toHaveLength(1);
  });

  it('keeps offline matches without claiming an online complete result', () => {
    mockOnline = false;
    const { result } = renderHook(useUsage);
    expect(result.current.complete).toBe(false);
    expect(result.current.results).toHaveLength(1);
  });

  it('retains ordinary confirmed results and excludes the current note', () => {
    const { result } = renderHook(() => useScriptureUsage(reference, 'other', 'en'));
    expect(result.current.complete).toBe(true);
    expect(result.current.results).toEqual([]);
  });
});
