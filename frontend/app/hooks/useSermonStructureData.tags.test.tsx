import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import type { TFunction } from 'i18next';

import type { Sermon, Tag, ThoughtsBySection } from '@/models/models';
import { useSermonStructureData, type StructureEngineSource } from '@/hooks/useSermonStructureData';

let mockCanonicalCatalog: { requiredTags: Tag[]; customTags: Tag[] } = { requiredTags: [], customTags: [] };
const mockUseTags = jest.fn((_owner: string | null | undefined) => ({
  tags: mockCanonicalCatalog,
  requiredTags: mockCanonicalCatalog.requiredTags,
  customTags: mockCanonicalCatalog.customTags,
  allTags: mockCanonicalCatalog.customTags,
  loading: false,
  error: null,
  refreshTags: jest.fn(),
}));

jest.mock('@/hooks/useTags', () => ({ useTags: (...args: [string | null | undefined]) => mockUseTags(...args) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const translation = ((key: string) => key) as unknown as TFunction;
const structure: ThoughtsBySection = { introduction: ['thought-a'], main: [], conclusion: [], ambiguous: [] };
const sermonFor = (owner: string): Sermon => ({
  id: 'sermon-shared', userId: owner, title: 'Shared sermon', verse: 'John 3:16', date: '2026-11-02',
  thoughts: [{ id: 'thought-a', text: 'A thought', tags: ['Grace'], date: '2026-11-02T10:00:00.000Z' }],
  structure,
  outline: { introduction: [], main: [], conclusion: [] },
});
const engineFor = (sermon: Sermon, isHolding: () => boolean = () => false): StructureEngineSource => ({
  sermon, loading: false, error: null, isHolding, retry: jest.fn(),
});
const catalogTag = (color: string): Tag => ({ id: 'grace-id', userId: 'owner-a', name: 'Grace', color, required: false });
const setup = (seed: Record<string, { requiredTags: Tag[]; customTags: Tag[] }>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.entries(seed).forEach(([owner, tags]) => client.setQueryData(['tags', owner], tags));
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
};
const boardTag = (board: ReturnType<typeof useSermonStructureData>) => board.containers.introduction
  .find(item => item.id === 'thought-a')?.customTagNames?.[0];

beforeEach(() => {
  mockUseTags.mockClear();
  mockCanonicalCatalog = { requiredTags: [], customTags: [catalogTag('#dc2626')] };
});

describe('structure board uses the canonical public tag catalogue', () => {
  it('uses the public catalogue instead of a stale private React Query copy', async () => {
    const stale = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    const canonical = { requiredTags: [], customTags: [catalogTag('#dc2626')] };
    mockCanonicalCatalog = canonical;
    const { wrapper } = setup({ 'owner-a': stale });
    const source = engineFor(sermonFor('owner-a'));
    const { result } = renderHook(() => useSermonStructureData(translation, source), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect({ allowedTags: result.current.allowedTags, customTag: boardTag(result.current) }).toEqual({
      allowedTags: [{ name: 'Grace', color: '#dc2626' }],
      customTag: { name: 'Grace', color: '#dc2626' },
    });
  });

  it('updates the same mounted sermon board when the canonical tag colour changes', async () => {
    const stale = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    mockCanonicalCatalog = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    const { wrapper } = setup({ 'owner-a': stale });
    const source = engineFor(sermonFor('owner-a'));
    const { result, rerender } = renderHook(({ catalog }) => {
      mockCanonicalCatalog = catalog;
      return useSermonStructureData(translation, source);
    }, { wrapper, initialProps: { catalog: mockCanonicalCatalog } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#16a34a' });

    const updatedCanonical = { requiredTags: [], customTags: [catalogTag('#2563eb')] };
    rerender({ catalog: updatedCanonical });
    await waitFor(() => expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#2563eb' }));
  });

  it('repaints catalogue colour without replacing local sermon and board edits', async () => {
    const green = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    mockCanonicalCatalog = green;
    const { wrapper } = setup({ 'owner-a': green });
    const source = engineFor(sermonFor('owner-a'));
    const { result, rerender } = renderHook(({ catalog }) => {
      mockCanonicalCatalog = catalog;
      return useSermonStructureData(translation, source);
    }, { wrapper, initialProps: { catalog: green } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setSermon(current => ({ ...current!, title: 'Local title draft' }));
      result.current.setContainers(current => ({
        ...current,
        introduction: current.introduction.map(item => item.id === 'thought-a'
          ? { ...item, content: 'Local thought draft', position: 29 }
          : item),
      }));
    });
    expect(result.current.sermon?.title).toBe('Local title draft');
    expect(result.current.containers.introduction.find(item => item.id === 'thought-a'))
      .toEqual(expect.objectContaining({ content: 'Local thought draft', position: 29 }));
    expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#16a34a' });

    const blue = { requiredTags: [], customTags: [catalogTag('#2563eb')] };
    await act(async () => { rerender({ catalog: blue }); await Promise.resolve(); });
    expect(result.current.sermon?.title).toBe('Local title draft');
    expect(result.current.containers.introduction.find(item => item.id === 'thought-a'))
      .toEqual(expect.objectContaining({ content: 'Local thought draft', position: 29 }));
    await waitFor(() => expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#2563eb' }));
  });

  it('uses the next owner catalogue without leaking the previous owner colour', async () => {
    const ownerA = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    const ownerBTag = { ...catalogTag('#7c3aed'), id: 'owner-b-grace', userId: 'owner-b' };
    const ownerB = { requiredTags: [], customTags: [ownerBTag] };
    mockCanonicalCatalog = ownerA;
    const { wrapper } = setup({ 'owner-a': ownerA, 'owner-b': ownerB });
    let source = engineFor(sermonFor('owner-a'));
    const { result, rerender } = renderHook(() => useSermonStructureData(translation, source), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(boardTag(result.current)?.color).toBe('#16a34a');

    mockCanonicalCatalog = ownerB;
    source = engineFor(sermonFor('owner-b'));
    rerender();
    await waitFor(() => expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#7c3aed' }));
  });

  it('keeps the tag-only board update queued while a card is held, then applies it on release', async () => {
    const green = { requiredTags: [], customTags: [catalogTag('#16a34a')] };
    mockCanonicalCatalog = green;
    const { wrapper } = setup({ 'owner-a': green });
    let holding = false;
    const source = engineFor(sermonFor('owner-a'), () => holding);
    const { result, rerender } = renderHook(({ catalog }) => {
      mockCanonicalCatalog = catalog;
      return useSermonStructureData(translation, source);
    }, { wrapper, initialProps: { catalog: green } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#16a34a' });

    holding = true;
    const blue = { requiredTags: [], customTags: [catalogTag('#2563eb')] };
    rerender({ catalog: blue });
    await act(async () => { await Promise.resolve(); });
    expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#16a34a' });

    holding = false;
    act(() => result.current.syncFromEngine());
    expect(boardTag(result.current)).toEqual({ name: 'Grace', color: '#2563eb' });
  });

  it('keeps the displayed board while a card is held and applies the latest sermon after release', async () => {
    mockCanonicalCatalog = { requiredTags: [], customTags: [] };
    const { wrapper } = setup({ 'owner-a': mockCanonicalCatalog });
    let holding = false;
    let source = engineFor(sermonFor('owner-a'), () => holding);
    const { result, rerender } = renderHook(() => useSermonStructureData(translation, source), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.containers.introduction.map(item => item.id)).toContain('thought-a');

    holding = true;
    source = { ...source, sermon: { ...sermonFor('owner-a'), structure: { introduction: [], main: ['thought-a'], conclusion: [], ambiguous: [] } } };
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.containers.introduction.map(item => item.id)).toContain('thought-a');
    expect(result.current.containers.main.map(item => item.id)).not.toContain('thought-a');

    holding = false;
    act(() => result.current.syncFromEngine());
    expect(result.current.containers.main.map(item => item.id)).toContain('thought-a');
  });
});
