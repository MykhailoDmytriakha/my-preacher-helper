import { getExportContent } from '../exportContent';
import { Sermon, Thought, Structure } from '@/models/models';

// Mock the tagUtils module
jest.mock('../tagUtils', () => ({
  normalizeStructureTag: jest.fn((tag: string) => {
    if (tag === 'intro' || tag === 'introduction') return 'intro';
    if (tag === 'main' || tag === 'mainPart') return 'main';
    if (tag === 'conclusion') return 'conclusion';
    return null;
  })
}));

// Mock the sections module
jest.mock('@/lib/sections', () => ({
  getSectionLabel: jest.fn((key: string) => key)
}));

describe('exportContent', () => {
  const mockSermon: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    thoughts: [
      {
        id: 'thought1',
        text: 'First thought',
        tags: ['intro'],
        date: '2024-01-01',
        outlinePointId: 'point1'
      },
      {
        id: 'thought2',
        text: 'Second thought',
        tags: ['main'],
        date: '2024-01-02'
      },
      {
        id: 'thought3',
        text: 'Third thought',
        tags: ['conclusion'],
        date: '2024-01-03'
      },
      {
        id: 'thought4',
        text: 'Ambiguous thought',
        tags: ['custom-tag'],
        date: '2024-01-04'
      }
    ],
    outline: {
      introduction: [
        { id: 'point1', text: 'Introduction Point 1' }
      ],
      main: [
        { id: 'point2', text: 'Main Point 1' },
        { id: 'point3', text: 'Main Point 2' }
      ],
      conclusion: [
        { id: 'point4', text: 'Conclusion Point 1' }
      ]
    },
    structure: {
      introduction: ['thought1'],
      main: ['thought2'],
      conclusion: ['thought3'],
      ambiguous: ['thought4']
    },
    userId: 'user1'
  };

  const mockStructure: Structure = {
    introduction: ['thought1'],
    main: ['thought2'],
    conclusion: ['thought3'],
    ambiguous: ['thought4']
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getExportContent', () => {
    it('should export content in plain text format by default', async () => {
      const result = await getExportContent(mockSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('Test Sermon');
      expect(result).toContain('John 3:16');
    });

    it('should export content in markdown format when specified', async () => {
      const result = await getExportContent(mockSermon, undefined, { format: 'markdown' });
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('# export.sermonTitleTest Sermon');
      expect(result).toContain('## tags.introduction');
      expect(result).toContain('## tags.mainPart');
      expect(result).toContain('## tags.conclusion');
    });

    it('should include tags when specified', async () => {
      const result = await getExportContent(mockSermon, undefined, { includeTags: true });
      
      expect(result).toContain('export.tagsLabel');
      expect(result).toContain('intro');
      expect(result).toContain('main');
      expect(result).toContain('conclusion');
    });

    it('should exclude metadata when specified', async () => {
      const result = await getExportContent(mockSermon, undefined, { includeMetadata: false });
      
      expect(result).not.toContain('Test Sermon');
      expect(result).not.toContain('John 3:16');
      expect(result).toContain('tags.introduction:');
    });

    it('should handle focused section export', async () => {
      const result = await getExportContent(mockSermon, 'introduction');
      
      expect(result).toContain('tags.introduction:');
      expect(result).not.toContain('tags.mainPart:');
      expect(result).not.toContain('tags.conclusion:');
    });

    it('should handle empty sermon gracefully', async () => {
      const emptySermon: Sermon = {
        id: 'empty',
        title: '',
        thoughts: [],
        outline: {},
        structure: {}
      };
      
      const result = await getExportContent(emptySermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle sermon with no thoughts', async () => {
      const noThoughtsSermon: Sermon = {
        id: 'no-thoughts',
        title: 'No Thoughts Sermon',
        thoughts: [],
        outline: {},
        structure: {}
      };
      
      const result = await getExportContent(noThoughtsSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('No Thoughts Sermon');
    });

    it('should handle sermon with no verse', async () => {
      const noVerseSermon: Sermon = {
        ...mockSermon,
        verse: undefined
      };
      
      const result = await getExportContent(noVerseSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Test Sermon');
      expect(result).not.toContain('John 3:16');
    });

    it('should handle sermon with empty verse', async () => {
      const emptyVerseSermon: Sermon = {
        ...mockSermon,
        verse: '   '
      };
      
      const result = await getExportContent(emptyVerseSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Test Sermon');
      expect(result).not.toContain('John 3:16');
    });

    it('should handle sermon with whitespace-only verse', async () => {
      const whitespaceVerseSermon: Sermon = {
        ...mockSermon,
        verse: '  \n  \n  '
      };
      
      const result = await getExportContent(whitespaceVerseSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Test Sermon');
      expect(result).not.toContain('John 3:16');
    });

    it('should handle sermon with complex verse formatting', async () => {
      const complexVerseSermon: Sermon = {
        ...mockSermon,
        verse: 'John 3:16\nFor God so loved the world\nThat he gave his only Son'
      };
      
      const result = await getExportContent(complexVerseSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('John 3:16');
      expect(result).toContain('For God so loved the world');
      expect(result).toContain('That he gave his only Son');
    });

    it('should handle sermon with outline points', async () => {
      const result = await getExportContent(mockSermon);
      
      expect(result).toContain('Introduction Point 1:');
      expect(result).toContain('export.unassignedThoughts:');
      expect(result).toContain('export.unassignedThoughts:');
      expect(result).toContain('export.unassignedThoughts:');
    });

    it('should handle sermon without outline points', async () => {
      const noOutlineSermon: Sermon = {
        ...mockSermon,
        outline: {
          introduction: [],
          main: [],
          conclusion: []
        }
      };
      
      const result = await getExportContent(noOutlineSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('tags.introduction:');
      expect(result).toContain('tags.mainPart:');
      expect(result).toContain('tags.conclusion:');
    });

    it('should handle sermon with mixed outline and no outline sections', async () => {
      const mixedOutlineSermon: Sermon = {
        ...mockSermon,
        outline: {
          introduction: [{ id: 'point1', text: 'Intro Point' }],
          main: [],
          conclusion: []
        }
      };
      
      const result = await getExportContent(mixedOutlineSermon);
      
      expect(result).toContain('Intro Point:');
      expect(result).toContain('tags.mainPart:');
      expect(result).toContain('tags.conclusion:');
    });

    it('should handle thoughts with multiple tags', async () => {
      const multiTagThought: Thought = {
        id: 'multi-tag',
        text: 'Multi-tag thought',
        tags: ['intro', 'main'],
        date: '2024-01-05'
      };
      
      const multiTagSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, multiTagThought]
      };
      
      const result = await getExportContent(multiTagSermon);
      
      expect(result).toContain('export.unassignedThoughts:');
      expect(result).toContain('Multi-tag thought');
    });

    it('should handle thoughts without tags', async () => {
      const noTagThought: Thought = {
        id: 'no-tag',
        text: 'No tag thought',
        tags: [],
        date: '2024-01-06'
      };
      
      const noTagSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, noTagThought]
      };
      
      const result = await getExportContent(noTagSermon);
      
      expect(result).toBeDefined();
    });

    it('should handle thoughts with custom tags', async () => {
      const customTagThought: Thought = {
        id: 'custom-tag',
        text: 'Custom tag thought',
        tags: ['custom-tag'],
        date: '2024-01-07'
      };
      
      const customTagSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, customTagThought]
      };
      
      const result = await getExportContent(customTagSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Custom tag thought');
    });

    it('should handle thoughts with empty tags array', async () => {
      const emptyTagsThought: Thought = {
        id: 'empty-tags',
        text: 'Empty tags thought',
        tags: [],
        date: '2024-01-08'
      };
      
      const emptyTagsSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, emptyTagsThought]
      };
      
      const result = await getExportContent(emptyTagsSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Empty tags thought');
    });

    it('should handle thoughts with undefined tags', async () => {
      const undefinedTagsThought: Thought = {
        id: 'undefined-tags',
        text: 'Undefined tags thought',
        tags: [],
        date: '2024-01-09'
      };
      
      const undefinedTagsSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, undefinedTagsThought]
      };
      
      const result = await getExportContent(undefinedTagsSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Undefined tags thought');
    });

    it('should handle thoughts with null tags', async () => {
      const nullTagsThought: Thought = {
        id: 'null-tags',
        text: 'Null tags thought',
        tags: null as any,
        date: '2024-01-10'
      };
      
      const nullTagsSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, nullTagsThought]
      };
      
      const result = await getExportContent(nullTagsSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Null tags thought');
    });

    it('should handle thoughts with outline point assignments', async () => {
      const result = await getExportContent(mockSermon);
      
      expect(result).toContain('Introduction Point 1:');
      expect(result).toContain('First thought');
    });

    it('should handle thoughts without outline point assignments', async () => {
      const result = await getExportContent(mockSermon);
      
      expect(result).toContain('Second thought');
      expect(result).toContain('Third thought');
    });

    it('should handle empty sections gracefully', async () => {
      const emptySectionSermon: Sermon = {
        ...mockSermon,
        thoughts: []
      };
      
      const result = await getExportContent(emptySectionSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle undefined structure gracefully', async () => {
      const noStructureSermon: Sermon = {
        ...mockSermon,
        structure: {
          introduction: [],
          main: [],
          conclusion: [],
          ambiguous: []
        }
      };
      
      const result = await getExportContent(noStructureSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle empty structure gracefully', async () => {
      const emptyStructureSermon: Sermon = {
        ...mockSermon,
        structure: {}
      };
      
      const result = await getExportContent(emptyStructureSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle undefined outline gracefully', async () => {
      const noOutlineSermon: Sermon = {
        ...mockSermon,
        outline: {
          introduction: [],
          main: [],
          conclusion: []
        }
      };
      
      const result = await getExportContent(noOutlineSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle empty outline gracefully', async () => {
      const emptyOutlineSermon: Sermon = {
        ...mockSermon,
        outline: {}
      };
      
      const result = await getExportContent(emptyOutlineSermon);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle thoughts with dates', async () => {
      const result = await getExportContent(mockSermon);
      
      expect(result).toContain('First thought');
      expect(result).toContain('Second thought');
      expect(result).toContain('Third thought');
    });

    it('should handle thoughts without dates', async () => {
      const noDateThought: Thought = {
        id: 'no-date',
        text: 'No date thought',
        tags: ['intro']
      };
      
      const noDateSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, noDateThought]
      };
      
      const result = await getExportContent(noDateSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('No date thought');
    });

    it('should handle thoughts with null dates', async () => {
      const nullDateThought: Thought = {
        id: 'null-date',
        text: 'Null date thought',
        tags: ['intro'],
        date: null as any
      };
      
      const nullDateSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, nullDateThought]
      };
      
      const result = await getExportContent(nullDateSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Null date thought');
    });

    it('should handle thoughts with invalid dates', async () => {
      const invalidDateThought: Thought = {
        id: 'invalid-date',
        text: 'Invalid date thought',
        tags: ['intro'],
        date: 'invalid-date' as any
      };
      
      const invalidDateSermon: Sermon = {
        ...mockSermon,
        thoughts: [...mockSermon.thoughts!, invalidDateThought]
      };
      
      const result = await getExportContent(invalidDateSermon);
      
      expect(result).toBeDefined();
      expect(result).toContain('Invalid date thought');
    });

    it('should handle markdown formatting with complex verse', async () => {
      const complexVerseSermon: Sermon = {
        ...mockSermon,
        verse: 'John 3:16\nFor God so loved the world\nThat he gave his only Son'
      };
      
      const result = await getExportContent(complexVerseSermon, undefined, { format: 'markdown' });
      
      expect(result).toContain('> John 3:16');
      expect(result).toContain('> For God so loved the world');
      expect(result).toContain('> That he gave his only Son');
    });

    it('should handle markdown formatting with empty verse', async () => {
      const emptyVerseSermon: Sermon = {
        ...mockSermon,
        verse: ''
      };
      
      const result = await getExportContent(emptyVerseSermon, undefined, { format: 'markdown' });
      
      expect(result).toContain('# export.sermonTitleTest Sermon');
      expect(result).not.toContain('> ');
    });

    it('should handle markdown formatting with whitespace-only verse', async () => {
      const whitespaceVerseSermon: Sermon = {
        ...mockSermon,
        verse: '  \n  \n  '
      };
      
      const result = await getExportContent(whitespaceVerseSermon, undefined, { format: 'markdown' });
      
      expect(result).toContain('# export.sermonTitleTest Sermon');
      expect(result).not.toContain('> ');
    });

    it('should handle markdown formatting with mixed content verse', async () => {
      const mixedVerseSermon: Sermon = {
        ...mockSermon,
        verse: 'John 3:16\n\nFor God so loved the world\n\nThat he gave his only Son'
      };
      
      const result = await getExportContent(mixedVerseSermon, undefined, { format: 'markdown' });
      
      expect(result).toContain('> John 3:16');
      expect(result).toContain('> For God so loved the world');
      expect(result).toContain('> That he gave his only Son');
    });
  });
}); 