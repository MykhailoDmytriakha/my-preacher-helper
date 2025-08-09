import { renderHook, act, waitFor } from '@testing-library/react';
import { useSermonStructureData } from './useSermonStructureData';
import { getSermonById } from '@/services/sermon.service';
import { getTags } from '@/services/tag.service';
import { getSermonOutline } from '@/services/outline.service';
import { toast } from 'sonner';
import { TFunction } from 'i18next';
import { Item, Sermon, OutlinePoint, Tag, Thought, Structure, Outline } from '@/models/models';

// Mocks
jest.mock('@/services/sermon.service');
jest.mock('@/services/tag.service');
jest.mock('@/services/outline.service');
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

// Sample Data
const mockThoughts: Thought[] = [
  { id: 't1', text: 'Intro thought', tags: ['вступление'], outlinePointId: 'op1', date: '2023-01-01T10:00:00Z' },
  { id: 't2', text: 'Main thought 1', tags: ['основная часть', 'grace'], date: '2023-01-01T10:01:00Z' },
  { id: 't3', text: 'Main thought 2', tags: ['Main Part', 'faith'], date: '2023-01-01T10:02:00Z' },
  { id: 't4', text: 'Conclusion thought', tags: ['заключение'], date: '2023-01-01T10:03:00Z' },
  { id: 't5', text: 'Ambiguous thought', tags: ['random'], date: '2023-01-01T10:04:00Z' },
  { id: 't6', text: 'Untagged thought', tags: [], date: '2023-01-01T10:05:00Z' },
  { id: 't7', text: 'Thought for structure', tags: [], date: '2023-01-01T10:06:00Z' },
];

const mockStructure: Structure = {
    introduction: ['t7'],
    main: [],
    conclusion: [],
    ambiguous: [],
};

const mockOutline: Outline = {
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

describe('useSermonStructureData Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedGetSermonById.mockClear();
    mockedGetTags.mockClear();
    mockedGetSermonOutline.mockClear();
    mockedToastError.mockClear();

    // Default successful mock implementations
    mockedGetSermonById.mockResolvedValue(mockSermon);
    mockedGetTags.mockResolvedValue(mockTagsData);
    mockedGetSermonOutline.mockResolvedValue(mockOutlineData);
  });

  it('should initialize with loading state true and default values', () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));
    expect(result.current.loading).toBe(true);
    expect(result.current.sermon).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
    expect(result.current.allowedTags).toEqual([]);
  });

  it('should fetch data and update state on successful load', async () => {
    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));

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
    expect(result.current.containers.introduction[0].requiredTags).toEqual(['Introduction']);

    // t1, t2, t3, t4, t5, t6 were not in structure, should go to ambiguous
    expect(result.current.containers.ambiguous.find(item => item.id === 't1')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't2')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't3')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't4')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't5')).toBeDefined();
    expect(result.current.containers.ambiguous.find(item => item.id === 't6')).toBeDefined();
    expect(result.current.containers.ambiguous.length).toBe(6);

     // Check tags are correctly assigned to items in ambiguous
     const t1Item = result.current.containers.ambiguous.find(item => item.id === 't1');
     expect(t1Item?.requiredTags).toEqual([]); // Moved to ambiguous, required tags cleared
     expect(t1Item?.customTagNames).toEqual([]); // No custom tags matched

     const t2Item = result.current.containers.ambiguous.find(item => item.id === 't2');
     expect(t2Item?.requiredTags).toEqual([]); // Moved to ambiguous
     expect(t2Item?.customTagNames).toEqual([{ name: 'Grace', color: '#ffff00' }]);

     const t3Item = result.current.containers.ambiguous.find(item => item.id === 't3');
     expect(t3Item?.requiredTags).toEqual([]); // Moved to ambiguous
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
    const { result } = renderHook(() => useSermonStructureData(null, mockT as any));

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

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));

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

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(mockSermon); // Sermon fetch succeeded
    expect(result.current.error).toBeNull(); // Error handled, not set at hook level
    expect(mockedToastError).toHaveBeenCalledWith(mockTranslations['errors.fetchTagsError']);

    // Allowed tags should be empty as fetch failed
    expect(result.current.allowedTags).toEqual([]);

    // Outline should still be fetched
    expect(mockedGetSermonOutline).toHaveBeenCalledWith('sermon123');
    expect(result.current.outlinePoints).toEqual(mockOutlineData);

    // Items should be processed without tag enrichment from fetched tags,
    // but might get default enrichment based on the thought's own tag strings.
    const t2Item = result.current.containers.ambiguous.find(item => item.id === 't2');
    // Check for default enrichment: 'grace' tag exists on thought, but not in fetched tags,
    // so it gets the default color.
    expect(t2Item?.customTagNames).toEqual([{ name: 'grace', color: '#4c51bf' }]);
  });

  it('should handle error during getSermonOutline but continue processing', async () => {
    const outlineError = new Error('Failed to fetch outline');
    mockedGetSermonOutline.mockRejectedValue(outlineError);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.sermon).toEqual(mockSermon); // Sermon fetch succeeded
    expect(result.current.error).toBeNull(); // Error handled, not set at hook level
    expect(mockedToastError).toHaveBeenCalledWith('Failed to fetch outline'); // Check translated error

    // Tags should be processed correctly
    expect(mockedGetTags).toHaveBeenCalledWith(mockSermon.userId);
    expect(result.current.allowedTags.length).toBeGreaterThan(0);

    // Outline points should be default empty arrays
    expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
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
    } as any;
    mockedGetSermonById.mockResolvedValueOnce(sermonWithDupes);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const introIds = result.current.containers.introduction.map((i) => i.id);
    expect(introIds).toEqual(['t7', 't1']);
    // Ensure not duplicated elsewhere
    expect(result.current.containers.ambiguous.some(i => i.id === 't7' || i.id === 't1')).toBe(false);
  });

  it('seeds positions when missing (ambiguous) and sorts by position when present (structure-driven)', async () => {
    const sermonNoPositions: Sermon = {
      ...mockSermon,
      // clear structure so most go to ambiguous and get seeded
      structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 'p1', text: 'A', tags: ['вступление'], date: '2023-01-01T10:00:00Z' } as any,
        { id: 'p2', text: 'B', tags: ['вступление'], date: '2023-01-01T10:00:01Z' } as any,
        { id: 'p3', text: 'C', tags: ['random'], date: '2023-01-01T10:00:02Z' } as any,
      ],
    };
    mockedGetSermonById.mockResolvedValueOnce(sermonNoPositions);

    const { result } = renderHook(() => useSermonStructureData('sermon123', mockT as any));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Items without clear section tag go to ambiguous; positions should be seeded for stable ordering
    const amb = result.current.containers.ambiguous;
    expect(amb.length).toBe(3);
    expect(typeof amb[0].position).toBe('number');
    expect(typeof amb[1].position).toBe('number');
    expect(typeof amb[2].position).toBe('number');
    expect((amb[0].position as number) < (amb[1].position as number)).toBe(true);

    // Now test sorting by explicit positions
    const sermonWithPositions: Sermon = {
      ...mockSermon,
      structure: { introduction: ['x1', 'x2', 'x3'], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 'x1', text: '1', tags: ['вступление'], position: 3000, date: '2023-01-01T10:00:00Z' } as any,
        { id: 'x2', text: '2', tags: ['вступление'], position: 1000, date: '2023-01-01T10:00:01Z' } as any,
        { id: 'x3', text: '3', tags: ['вступление'], position: 2000, date: '2023-01-01T10:00:02Z' } as any,
      ],
    };
    mockedGetSermonById.mockResolvedValueOnce(sermonWithPositions);

    const { result: result2 } = renderHook(() => useSermonStructureData('sermon456', mockT as any));
    await waitFor(() => expect(result2.current.loading).toBe(false));

    const order = result2.current.containers.introduction.map(i => i.id);
    expect(order).toEqual(['x2', 'x3', 'x1']);
  });

  it('uses structure to prevent duplicates even if tags would place items elsewhere', async () => {
    const sermonConflict: Sermon = {
      ...mockSermon,
      structure: { introduction: ['t3'], main: [], conclusion: [], ambiguous: [] },
      thoughts: [
        { id: 't3', text: 'C', tags: ['Main Part'], date: '2023-01-01T10:02:00Z' } as any,
      ],
    };
    mockedGetSermonById.mockResolvedValueOnce(sermonConflict);

    const { result } = renderHook(() => useSermonStructureData('sermon789', mockT as any));
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

        const { result } = renderHook(() => useSermonStructureData('sermonEmpty', mockT as any));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.loading).toBe(false);
        expect(result.current.sermon).toEqual(emptySermon);
        expect(result.current.error).toBeNull();
        expect(result.current.containers).toEqual({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        expect(result.current.outlinePoints).toEqual({ introduction: [], main: [], conclusion: [] });
        expect(result.current.allowedTags).toEqual([]);
    });

}); 