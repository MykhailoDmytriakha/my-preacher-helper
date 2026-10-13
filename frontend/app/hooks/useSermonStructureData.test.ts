import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { TFunction } from 'i18next';
import { toast } from 'sonner';

import { Sermon, Thought, ThoughtsBySection, SermonOutline } from '@/models/models';
import { getTags } from '@/services/tag.service';

import { useSermonStructureData, type StructureEngineSource } from './useSermonStructureData';




// Mocks
jest.mock('@/services/tag.service');
jest.mock('sonner');

// Simple mock TFunction for translations
const mockTranslations: Record<string, string> = {
  'structure.introduction': 'Introduction',
  'structure.mainPart': 'Main Part',
  'structure.conclusion': 'Conclusion',
  'structure.underConsideration': 'Under Consideration',
  'errors.fetchSermonStructureError': 'Failed to fetch sermon structure',
  'errors.fetchTagsError': 'Failed to fetch tags',
  'errors.fetchOutlineError': 'Failed to fetch outline',
};
const mockT = (key: string | string[]) => {
  const lookupKey = Array.isArray(key) ? key[0] : key;
  return mockTranslations[lookupKey] || lookupKey;
};

// Type for the mock translation function
type MockTFunction = TFunction;



// Sample Data
const mockThoughts: Thought[] = [
  { id: 't1', text: 'Intro thought', tags: ['вступление'], outlinePointId: 'op1', date: '2023-01-01T10:00:00Z', isLocked: true },
  { id: 't2', text: 'Main thought 1', tags: ['основная часть', 'grace'], date: '2023-01-01T10:01:00Z' },
  { id: 't3', text: 'Main thought 2', tags: ['Main Part', 'faith'], date: '2023-01-01T10:02:00Z' },
  { id: 't4', text: 'Conclusion thought', tags: ['заключение'], date: '2023-01-01T10:03:00Z' },
  { id: 't5', text: 'Ambiguous thought', tags: ['random'], date: '2023-01-01T10:04:00Z' },
  { id: 't6', text: 'Untagged thought', tags: [], date: '2023-01-01T10:05:00Z' },
  { id: 't7', text: 'Thought for structure', tags: [], date: '2023-01-01T10:06:00Z' },
];

const mockStructure: ThoughtsBySection = {
  introduction: ['t7'],
  main: [],
  conclusion: [],
  ambiguous: [],
};

const mockOutline: SermonOutline = {
  introduction: [{ id: 'op1', text: 'Opening point' }],
  main: [{ id: 'op2', text: 'Main point A' }],
  conclusion: [],
};

const mockSermon: Sermon = {
  id: 'sermon123',
  userId: 'user1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2023-01-01',
  thoughts: mockThoughts,
  structure: mockStructure,
  outline: mockOutline,
};

const mockTagsData = {
  requiredTags: [
    { id: 'req1', name: 'Вступление', color: '#ff0000' },
    { id: 'req2', name: 'Основная Часть', color: '#00ff00' },
    { id: 'req3', name: 'Заключение', color: '#0000ff' },
  ],
  customTags: [
    { id: 'cust1', name: 'Grace', color: '#ffff00' },
    { id: 'cust2', name: 'Faith', color: '#ff00ff' },
    { id: 'cust3', name: 'Random', color: '#00ffff' },
  ],
};

const mockOutlineData = {
  introduction: [{ id: 'op1', text: 'Opening point' }],
  main: [{ id: 'op2', text: 'Main point A' }],
  conclusion: [],
};

/** The engine's copy of a sermon, as the structure screen receives it. */
const engineOf = (sermon: Sermon | null, extra: Partial<StructureEngineSource> = {}): StructureEngineSource => ({
  sermon,
  loading: false,
  error: null,
  isHolding: () => false,
  retry: jest.fn(),
  ...extra,
});

// Type cast mocks
const mockedGetTags = getTags as jest.Mock;
const mockedToastError = toast.error as jest.Mock;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

const renderData = (sermon: Sermon | null, extra: Partial<StructureEngineSource> = {}) => {
  const engine = engineOf(sermon, extra);
  return { engine, ...renderHook(() => useSermonStructureData(mockT as MockTFunction, engine), { wrapper: createWrapper() }) };
};

describe('useSermonStructureData Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedGetTags.mockClear();
    mockedToastError.mockClear();

    // Default successful mock implementations
    mockedGetTags.mockResolvedValue(mockTagsData);
  });

  it('shows empty outline sections when the engine document has no outline', async () => {
    const { result } = renderData({ ...mockSermon, outline: undefined });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
  });

  it('does not rebuild an open editor when the engine source is re-rendered unchanged', async () => {
    const { result, rerender } = renderData(mockSermon);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setSermon(prev => ({ ...prev!, title: 'My pending edit' })); });
    rerender();
    await act(async () => {});
    expect(result.current.sermon?.title).toBe('My pending edit');
  });

  it('should initialize with loading state true and default values while the engine is still loading', () => {
    const { result } = renderData(null, { loading: true });
    expect(result.current.loading).toBe(true);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
    expect(result.current.allowedTags).toEqual([]);
  });

  it('should build the board from the engine document on a successful load', async () => {
    const { result } = renderData(mockSermon);

    // Wait for the loading to finish
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verify service calls
    expect(mockedGetTags).toHaveBeenCalledWith(mockSermon.userId);

    // Verify final state
    expect(result.current.sermon).toEqual(mockSermon);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    // Verify container assignment logic
    expect(result.current.containers.introduction.find(item => item.id === 't7')).toBeDefined();
    expect(result.current.containers.introduction[0].requiredTags).toEqual([]);
    expect(result.current.containers.introduction.find(item => item.id === 't1')).toBeDefined();

    expect(result.current.containers.main.find(item => item.id === 't2')).toBeDefined();
    expect(result.current.containers.main.find(item => item.id === 't3')).toBeDefined();

    expect(result.current.containers.conclusion.find(item => item.id === 't4')).toBeDefined();

    // t5, t6 have no structure tags, should go to ambiguous
    expect(result.current.containers.ambiguous.find(item => item.id === 't5')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't6')).toBeDefined();
    expect(result.current.containers.ambiguous.length).toBe(2);

    // Check tags are correctly assigned to items in sections
    const t1Item = result.current.containers.introduction.find(item => item.id === 't1');
    expect(t1Item?.requiredTags).toEqual([]);
    expect(t1Item?.customTagNames).toEqual([]); // No custom tags matched
    expect(t1Item?.isLocked).toBe(true);

    const t2Item = result.current.containers.main.find(item => item.id === 't2');
    expect(t2Item?.requiredTags).toEqual([]);
    expect(t2Item?.customTagNames).toEqual([{ name: 'Grace', color: '#ffff00' }]);
    expect(t2Item?.isLocked).toBe(false);

    const t3Item = result.current.containers.main.find(item => item.id === 't3');
    expect(t3Item?.requiredTags).toEqual([]);
    expect(t3Item?.customTagNames).toEqual([{ name: 'Faith', color: '#ff00ff' }]);

    // Verify outline points
    expect(result.current.outlinePoints.introduction).toEqual(mockOutlineData.introduction);
    expect(result.current.outlinePoints.main).toEqual(mockOutlineData.main);
    expect(result.current.outlinePoints.conclusion).toEqual(mockOutlineData.conclusion);

    // Verify allowed tags (custom tags excluding section names)
    expect(result.current.allowedTags).toEqual([
      { name: 'Grace', color: '#ffff00' },
      { name: 'Faith', color: '#ff00ff' },
      { name: 'Random', color: '#00ffff' },
    ]);
  });

  it('stays empty and not loading when the engine has no document and is not loading', async () => {
    const { result } = renderData(null);

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(mockedGetTags).not.toHaveBeenCalled();
  });

  it('reports the engine error while there is no document, and hands out the engine retry', async () => {
    const retry = jest.fn();
    const { result } = renderData(null, { error: 'Failed to fetch sermon structure', retry });

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBe('Failed to fetch sermon structure');
    expect(result.current.retry).toBe(retry);
    expect(mockedGetTags).not.toHaveBeenCalled();
  });

  it('drops the error once the engine has a document', async () => {
    const { result } = renderData(mockSermon, { error: 'stale error' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('should handle error during getTags but continue processing', async () => {
    const tagsError = new Error('Tags fetch failed');
    mockedGetTags.mockRejectedValue(tagsError);

    const { result } = renderData(mockSermon);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(mockSermon); // The board is still built
    expect(result.current.error).toBeNull(); // Error handled, not set at hook level
    expect(mockedToastError).toHaveBeenCalledWith(mockTranslations['errors.fetchTagsError']);

    // Allowed tags should be empty as fetch failed
    expect(result.current.allowedTags).toEqual([]);

    // Outline stays on the engine document's copy
    expect(result.current.outlinePoints).toEqual(mockOutlineData);

    // Items should be processed without tag enrichment from fetched tags,
    // but might get default enrichment based on the thought's own tag strings.
    const t2Item = result.current.containers.main.find(item => item.id === 't2');
    // Check for default enrichment: 'grace' tag exists on thought, but not in fetched tags,
    // so it gets the default color.
    expect(t2Item?.customTagNames).toEqual([{ name: 'grace', color: '#4c51bf' }]);
  });

  it('should sync outlinePoints with sermon.outline when outline is updated', async () => {
    const { result } = renderData(mockSermon);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Initial state
    expect(result.current.outlinePoints).toEqual({
      introduction: [{ id: 'op1', text: 'Opening point' }],
      main: [{ id: 'op2', text: 'Main point A' }],
      conclusion: [],
    });

    // Simulate sermon outline update with isReviewed field
    const updatedOutline: SermonOutline = {
      introduction: [{ id: 'op1', text: 'Opening point', isReviewed: true }],
      main: [
        { id: 'op2', text: 'Main point A' },
        { id: 'op3', text: 'New point', isReviewed: false }
      ],
      conclusion: [{ id: 'op4', text: 'Conclusion point', isReviewed: true }],
    };

    // Update the sermon state
    act(() => {
      result.current.setSermon({
        ...mockSermon,
        outline: updatedOutline,
      });
    });

    // outlinePoints should be synced with the new outline
    await waitFor(() => {
      expect(result.current.outlinePoints).toEqual(updatedOutline);
    });
  });

  it('should handle outline points with isReviewed field from initial load', async () => {
    const outlineWithReviews: SermonOutline = {
      introduction: [{ id: 'op1', text: 'Opening point', isReviewed: true }],
      main: [{ id: 'op2', text: 'Main point A', isReviewed: false }],
      conclusion: [{ id: 'op3', text: 'Conclusion point', isReviewed: true }],
    };

    const sermonWithReviewedOutline: Sermon = {
      ...mockSermon,
      outline: outlineWithReviews,
    };

    mockedGetTags.mockResolvedValueOnce({ requiredTags: [], customTags: [] });

    const { result } = renderData(sermonWithReviewedOutline);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.outlinePoints).toEqual(outlineWithReviews);
  });

  it('should handle partial outline updates with isReviewed field', async () => {
    const { result } = renderData(mockSermon);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Update only main section with isReviewed field
    const partialUpdate: SermonOutline = {
      introduction: mockOutline.introduction,
      main: [{ id: 'op2', text: 'Main point A', isReviewed: true }],
      conclusion: mockOutline.conclusion,
    };

    act(() => {
      result.current.setSermon({
        ...mockSermon,
        outline: partialUpdate,
      });
    });

    await waitFor(() => {
      expect(result.current.outlinePoints).toEqual(partialUpdate);
    });
  });

  it('should handle empty outline sections with isReviewed fields', async () => {
    const emptyOutlineWithReviews: SermonOutline = {
      introduction: [],
      main: [{ id: 'op1', text: 'Only main point', isReviewed: true }],
      conclusion: [],
    };

    const sermonWithEmptySections: Sermon = {
      ...mockSermon,
      outline: emptyOutlineWithReviews,
    };

    mockedGetTags.mockResolvedValueOnce({ requiredTags: [], customTags: [] });

    const { result } = renderData(sermonWithEmptySections);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.outlinePoints).toEqual(emptyOutlineWithReviews);
  });

  it('dedupes duplicate ids from structure while preserving order', async () => {
    const sermonWithDupes: Sermon = {
      ...mockSermon,
      structure: {
        introduction: ['t7', 't7', 't1', 't1'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
    };

    const { result } = renderData(sermonWithDupes);
    await waitFor(() => expect(result.current.loading).toBe(false));

    const introIds = result.current.containers.introduction.map((i) => i.id);
    expect(introIds).toEqual(['t1', 't7']);
    // Ensure not duplicated elsewhere
    expect(result.current.containers.ambiguous.some(i => i.id === 't7' || i.id === 't1')).toBe(false);
  });

  it('seeds positions when missing (ambiguous) and respects structure order when present', async () => {
    const sermonNoPositions: Sermon = {
      ...mockSermon,
      // clear structure so most go to ambiguous and get seeded
      structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 'p1', text: 'A', tags: ['вступление'], date: '2023-01-01T10:00:00Z' },
        { id: 'p2', text: 'B', tags: ['вступление'], date: '2023-01-01T10:00:01Z' },
        { id: 'p3', text: 'C', tags: ['random'], date: '2023-01-01T10:00:02Z' },
      ],
    };

    const { result } = renderData(sermonNoPositions);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Items with structure tags go to their sections; positions should be seeded for stable ordering
    const introItems = result.current.containers.introduction;
    expect(introItems.length).toBe(2);
    expect(typeof introItems[0].position).toBe('number');
    expect(typeof introItems[1].position).toBe('number');
    expect((introItems[0].position as number) < (introItems[1].position as number)).toBe(true);

    const amb = result.current.containers.ambiguous;
    expect(amb.length).toBe(1);
    expect(typeof amb[0].position).toBe('number');

    // Now test respecting structure order even if positions are different
    const sermonWithPositions: Sermon = {
      ...mockSermon,
      structure: { introduction: ['x1', 'x2', 'x3'], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 'x1', text: '1', tags: ['вступление'], position: 3000, date: '2023-01-01T10:00:00Z' },
        { id: 'x2', text: '2', tags: ['вступление'], position: 1000, date: '2023-01-01T10:00:02Z' },
        { id: 'x3', text: '3', tags: ['вступление'], position: 2000, date: '2023-01-01T10:00:02Z' },
      ],
    };

    const { result: result2 } = renderData(sermonWithPositions);
    await waitFor(() => expect(result2.current.loading).toBe(false));

    const order = result2.current.containers.introduction.map(i => i.id);
    expect(order).toEqual(['x1', 'x2', 'x3']);
  });

  it('uses structure to prevent duplicates even if tags would place items elsewhere', async () => {
    const sermonConflict: Sermon = {
      ...mockSermon,
      structure: { introduction: ['t3'], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 't3', text: 'C', tags: ['Main Part'], date: '2023-01-01T10:02:00Z' },
      ],
    };
    const { result } = renderData(sermonConflict);
    await waitFor(() => expect(result.current.loading).toBe(false));

    const introHas = result.current.containers.introduction.some(i => i.id === 't3');
    const mainHas = result.current.containers.main.some(i => i.id === 't3');
    const ambHas = result.current.containers.ambiguous.some(i => i.id === 't3');
    expect(introHas).toBe(true);
    expect(mainHas).toBe(false);
    expect(ambHas).toBe(false);
  });
  it('should correctly process sermon with empty thoughts, structure, or outline', async () => {
    const emptySermon: Sermon = {
      id: 'sermonEmpty',
      userId: 'user1',
      title: 'Empty Sermon',
      verse: '-',
      date: '2023-01-02',
      thoughts: [],
      structure: undefined,
      outline: undefined,
    };
    mockedGetTags.mockResolvedValue({ requiredTags: [], customTags: [] }); // No tags

    const { result } = renderData(emptySermon);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(emptySermon);
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
    expect(result.current.allowedTags).toEqual([]);
  });

});

describe('useSermonStructureData on the engine', () => {
  const sermonWith = (structure: ThoughtsBySection): Sermon => ({ ...mockSermon, structure, thoughtsBySection: structure });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
  const ids = (items: { id: string }[] | undefined) => (items ?? []).map(item => item.id);

  beforeEach(() => {
    jest.clearAllMocks();
    (getTags as jest.Mock).mockResolvedValue({ requiredTags: [], customTags: [] });
  });

  it('builds the board from the engine document', async () => {
    const engine = engineOf(sermonWith({ introduction: ['t7'], main: ['t2'], conclusion: [], ambiguous: [] }));
    const { result } = renderHook(() => useSermonStructureData(mockT as MockTFunction, engine), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current.containers.introduction)).toContain('t7');
  });

  it('follows a remote move, but waits while a card is in hand and catches up afterwards', async () => {
    let holding = false;
    let engine = engineOf(sermonWith({ introduction: ['t7'], main: [], conclusion: [], ambiguous: [] }), { isHolding: () => holding });
    const { result, rerender } = renderHook(({ source }) => useSermonStructureData(mockT as MockTFunction, source), { wrapper, initialProps: { source: engine } });
    await waitFor(() => expect(ids(result.current.containers.introduction)).toContain('t7'));

    // Another device moves t7 to the conclusion while nobody is dragging: the board follows.
    engine = { ...engine, sermon: sermonWith({ introduction: [], main: [], conclusion: ['t7'], ambiguous: [] }) };
    rerender({ source: engine });
    await waitFor(() => expect(ids(result.current.containers.conclusion)).toContain('t7'));

    // A second remote move arrives mid-drag: the board holds still.
    holding = true;
    engine = { ...engine, sermon: sermonWith({ introduction: [], main: ['t7'], conclusion: [], ambiguous: [] }) };
    rerender({ source: engine });
    await act(async () => { await Promise.resolve(); });
    expect(ids(result.current.containers.conclusion)).toContain('t7');
    expect(ids(result.current.containers.main)).not.toContain('t7');

    // The drag ends: the waiting rebuild runs.
    holding = false;
    act(() => { result.current.syncFromEngine(); });
    expect(ids(result.current.containers.main)).toContain('t7');
  });
});
