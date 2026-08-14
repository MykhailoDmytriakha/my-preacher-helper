import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { TFunction } from 'i18next';
import { toast } from 'sonner';

import { Sermon, Thought, ThoughtsBySection, SermonOutline } from '@/models/models';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSermonOutline } from '@/services/outline.service';
import { getSermonById } from '@/services/sermon.service';
import { getTags } from '@/services/tag.service';

import { useSermonStructureData } from './useSermonStructureData';




// Mocks
jest.mock('@/services/sermon.service');
jest.mock('@/services/tag.service');
jest.mock('@/services/outline.service');
jest.mock('@/hooks/useOnlineStatus');
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

// Type cast mocks
const mockedGetSermonById = getSermonById as jest.Mock;
const mockedGetTags = getTags as jest.Mock;
const mockedGetSermonOutline = getSermonOutline as jest.Mock;
const mockedToastError = toast.error as jest.Mock;
const mockedUseOnlineStatus = useOnlineStatus as jest.Mock;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useSermonStructureData Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedGetSermonById.mockClear();
    mockedGetTags.mockClear();
    mockedGetSermonOutline.mockClear();
    mockedToastError.mockClear();
    mockedUseOnlineStatus.mockReturnValue(true);

    // Default successful mock implementations
    mockedGetSermonById.mockResolvedValue(mockSermon);
    mockedGetTags.mockResolvedValue(mockTagsData);
    mockedGetSermonOutline.mockResolvedValue(mockOutlineData);
  });

  it('should initialize with loading state true and default values', () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
    expect(result.current.allowedTags).toEqual([]);
  });

  it('should fetch data and update state on successful load', async () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    // Wait for the loading to finish
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verify service calls
    expect(mockedGetSermonById).toHaveBeenCalledWith('sermon123');
    expect(mockedGetTags).toHaveBeenCalledWith(mockSermon.userId);
    expect(mockedGetSermonOutline).toHaveBeenCalledWith('sermon123');

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

  it('should handle null sermonId by setting loading false and clearing data', async () => {
    const { result } = renderHook(() => useSermonStructureData(null, mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    // Should not be loading and data should be cleared/default
    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });

    // Verify services were not called
    expect(mockedGetSermonById).not.toHaveBeenCalled();
    expect(mockedGetTags).not.toHaveBeenCalled();
    expect(mockedGetSermonOutline).not.toHaveBeenCalled();
  });

  it('should handle error during getSermonById', async () => {
    const sermonError = new Error('Sermon fetch failed');
    mockedGetSermonById.mockRejectedValue(sermonError);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBe('Sermon fetch failed');
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] }); // State reset
    expect(mockedToastError).toHaveBeenCalledWith('Sermon fetch failed');

    // Other services should not be called
    expect(mockedGetTags).not.toHaveBeenCalled();
    expect(mockedGetSermonOutline).not.toHaveBeenCalled();
  });

  it('should handle error during getTags but continue processing', async () => {
    const tagsError = new Error('Tags fetch failed');
    mockedGetTags.mockRejectedValue(tagsError);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(mockSermon); // Sermon fetch succeeded
    expect(result.current.error).toBeNull(); // Error handled, not set at hook level
    expect(mockedToastError).toHaveBeenCalledWith(mockTranslations['errors.fetchTagsError']);

    // Allowed tags should be empty as fetch failed
    expect(result.current.allowedTags).toEqual([]);

    // SermonOutline should still be fetched
    expect(mockedGetSermonOutline).toHaveBeenCalledWith('sermon123');
    expect(result.current.outlinePoints).toEqual(mockOutlineData);

    // Items should be processed without tag enrichment from fetched tags,
    // but might get default enrichment based on the thought's own tag strings.
    const t2Item = result.current.containers.main.find(item => item.id === 't2');
    // Check for default enrichment: 'grace' tag exists on thought, but not in fetched tags,
    // so it gets the default color.
    expect(t2Item?.customTagNames).toEqual([{ name: 'grace', color: '#4c51bf' }]);
  });

  it('should handle error during getSermonOutline but continue processing', async () => {
    const outlineError = new Error('Failed to fetch outline');
    mockedGetSermonOutline.mockRejectedValue(outlineError);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(mockSermon); // Sermon fetch succeeded
    expect(result.current.error).toBeNull(); // Error handled, not set at hook level
    expect(mockedToastError).toHaveBeenCalledWith('Failed to fetch outline'); // Check translated error

    // Tags should be processed correctly
    expect(mockedGetTags).toHaveBeenCalledWith(mockSermon.userId);
    expect(result.current.allowedTags.length).toBeGreaterThan(0);

    // SermonOutline points should be synced with sermon.outline when getSermonOutline fails
    expect(result.current.outlinePoints).toEqual(mockOutline);
  });

  it('should sync outlinePoints with sermon.outline when outline is updated', async () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

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

    mockedGetSermonById.mockResolvedValueOnce(sermonWithReviewedOutline);
    mockedGetTags.mockResolvedValueOnce({ requiredTags: [], customTags: [] });

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.outlinePoints).toEqual(outlineWithReviews);
  });

  it('should handle partial outline updates with isReviewed field', async () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

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

    mockedGetSermonById.mockResolvedValueOnce(sermonWithEmptySections);
    mockedGetTags.mockResolvedValueOnce({ requiredTags: [], customTags: [] });

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });

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
    mockedGetSermonById.mockResolvedValueOnce(sermonWithDupes);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
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
    mockedGetSermonById.mockResolvedValueOnce(sermonNoPositions);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
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
    mockedGetSermonById.mockResolvedValueOnce(sermonWithPositions);

    const { result: result2 } = renderHook(() => useSermonStructureData('sermon456', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
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
    mockedGetSermonById.mockResolvedValueOnce(sermonConflict);

    const { result } = renderHook(() => useSermonStructureData('sermon789', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
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
    mockedGetSermonById.mockResolvedValue(emptySermon);
    mockedGetTags.mockResolvedValue({ requiredTags: [], customTags: [] }); // No tags
    mockedGetSermonOutline.mockResolvedValue(null); // No outline

    const { result } = renderHook(() => useSermonStructureData('sermonEmpty', mockT as MockTFunction), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(emptySermon);
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
    expect(result.current.allowedTags).toEqual([]);
  });

});

/**
 * Freshness of what the preacher is looking at.
 *
 * The locally stored copy plays TWO roles at once, and the difference decides who
 * wins. It is the snapshot left over from an earlier session — which may be days
 * old, because the store keeps entries for a week — and it is also where an edit
 * made on this screen lives until the server confirms it. Preferring the stored
 * copy blindly shows yesterday's paragraph as if it were current; preferring the
 * server blindly wipes an edit that has not been saved yet. Both are silent, and
 * both cost the preacher words he spoke aloud.
 *
 * The revision counter already separates them: another device's saved edit raises
 * it, an unsaved local edit does not. So "the server's number is higher" means
 * "somebody else stored something newer" and nothing else.
 */
describe('useSermonStructureData · which copy the screen shows', () => {
  // The stored copy is filed under its owner, and the suite signs in as this uid
  // (jest.setup.js). Seeding any other key silently misses and the test would then
  // measure a cache that was never there.
  const cacheKeyFor = (sermonId: string) => ['sermon', 'test-user-id', sermonId];

  const sermonWith = (text: string, revThoughts: number): Sermon => ({
    ...mockSermon,
    id: 'freshness1',
    rev: { thoughts: revThoughts },
    thoughts: [{ id: 't1', text, tags: [], date: '2023-01-01T10:00:00Z' }],
    structure: { introduction: [], main: [], conclusion: [], ambiguous: ['t1'] },
  } as Sermon);

  const renderWithSeededCache = (seeded: Sermon | null, sermonId = 'freshness1') => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (seeded) queryClient.setQueryData(cacheKeyFor(sermonId), seeded);
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useSermonStructureData(sermonId, mockT as MockTFunction), { wrapper });
  };

  beforeEach(() => {
    mockedGetSermonById.mockClear();
    mockedGetTags.mockClear();
    mockedGetSermonOutline.mockClear();
    mockedUseOnlineStatus.mockReturnValue(true);
    mockedGetTags.mockResolvedValue({ requiredTags: [], customTags: [] });
    mockedGetSermonOutline.mockResolvedValue(null);
  });

  it('shows what the server stores when another device saved a newer version', async () => {
    // Left over from an earlier session on this machine…
    const stored = sermonWith('Older copy left on this device', 1);
    // …while the phone stored a newer version, which raised the revision.
    mockedGetSermonById.mockResolvedValue(sermonWith('Newer version saved elsewhere', 2));

    const { result } = renderWithSeededCache(stored);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Newer version saved elsewhere');
    expect(mockedGetSermonById).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit made here that the server has not stored yet', async () => {
    // The revision is the same on both sides: nothing was saved elsewhere, so the
    // difference in text is this screen's own work, waiting to be written.
    const unsavedEdit = sermonWith('Edited here, not saved yet', 4);
    mockedGetSermonById.mockResolvedValue(sermonWith('What the server still holds', 4));

    const { result } = renderWithSeededCache(unsavedEdit);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Edited here, not saved yet');
  });

  it('reads the stored copy and leaves the network alone while offline', async () => {
    mockedUseOnlineStatus.mockReturnValue(false);
    const stored = sermonWith('Available without a connection', 1);

    const { result } = renderWithSeededCache(stored);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Available without a connection');
    expect(mockedGetSermonById).not.toHaveBeenCalled();
  });

  it('falls back to the write timestamp on sermons written before revisions existed', async () => {
    // Most sermons carry no counters at all, so a rule that needs them would leave the
    // oldest ones — the likeliest to be stale — exactly as broken as before.
    const stored = { ...sermonWith('Older copy of an old sermon', 0), rev: undefined, updatedAt: '2026-08-01T10:00:00.000Z' } as Sermon;
    const server = { ...sermonWith('Newer version saved elsewhere', 0), rev: undefined, updatedAt: '2026-08-05T10:00:00.000Z' } as Sermon;
    mockedGetSermonById.mockResolvedValue(server);

    const { result } = renderWithSeededCache(stored);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Newer version saved elsewhere');
  });

  it('keeps an unsaved edit on an old sermon, because the timestamp did not move', async () => {
    const sameMoment = '2026-08-01T10:00:00.000Z';
    const unsavedEdit = { ...sermonWith('Edited here, not saved yet', 0), rev: undefined, updatedAt: sameMoment } as Sermon;
    const server = { ...sermonWith('What the server still holds', 0), rev: undefined, updatedAt: sameMoment } as Sermon;
    mockedGetSermonById.mockResolvedValue(server);

    const { result } = renderWithSeededCache(unsavedEdit);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Edited here, not saved yet');
  });

  it('keeps showing the stored copy when the server cannot be reached', async () => {
    // A refused or dropped request must not blank a sermon the preacher can see:
    // losing the screen is worse than showing a copy that may be a few minutes old.
    const stored = sermonWith('Still readable after a failed refresh', 1);
    mockedGetSermonById.mockRejectedValue(new Error('network down'));

    const { result } = renderWithSeededCache(stored);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermon?.thoughts[0].text).toBe('Still readable after a failed refresh');
  });
});
