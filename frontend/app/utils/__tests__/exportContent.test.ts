import { Sermon } from '@/models/models';
import { getExportContent } from '@/utils/exportContent';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock the tagUtils module
jest.mock('../tagUtils', () => {
  const normalizeStructureTag = jest.fn((tag: string) => {
    if (tag === 'intro' || tag === 'introduction') return 'intro';
    if (tag === 'main' || tag === 'mainPart') return 'main';
    if (tag === 'conclusion') return 'conclusion';
    return null;
  });
  return {
    normalizeStructureTag,
    isStructureTag: jest.fn((tag: string) => normalizeStructureTag(tag) !== null)
  };
});

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getExportContent', () => {
    it('handles format toggles and metadata combinations in one pass', async () => {
      await runScenarios([
        {
          name: 'plain text default',
          run: async () => {
            const result = await getExportContent(mockSermon);
            expect(result).toContain('Test Sermon');
            expect(result).toContain('John 3:16');
            expect(result).toContain('export.unassignedThoughts:');
          },
        },
        {
          name: 'markdown output',
          run: async () => {
            const result = await getExportContent(mockSermon, undefined, { format: 'markdown' });
            expect(result).toContain('# export.sermonTitleTest Sermon');
            expect(result).toContain('## tags.introduction');
            expect(result).toContain('## tags.mainPart');
            expect(result).toContain('## tags.conclusion');
          },
        },
        {
          name: 'include tags and omit metadata',
          run: async () => {
            const withTags = await getExportContent(mockSermon, undefined, { includeTags: true });
            expect(withTags).toContain('export.tagsLabel');
            expect(withTags).toContain('intro');
            const noMetadata = await getExportContent(mockSermon, undefined, { includeMetadata: false });
            expect(noMetadata).not.toContain('Test Sermon');
            expect(noMetadata).not.toContain('John 3:16');
            expect(noMetadata).toContain('tags.introduction:');
          },
        },
        {
          name: 'focused export',
          run: async () => {
            const result = await getExportContent(mockSermon, 'introduction');
            expect(result).toContain('tags.introduction:');
            expect(result).not.toContain('tags.mainPart:');
            expect(result).not.toContain('tags.conclusion:');
          },
        },
        {
          name: 'empty sermon and no-thoughts fallback',
          run: async () => {
            const emptySermon: Sermon = {
              id: 'empty',
              title: '',
              verse: '',
              date: '2024-01-01',
              userId: 'user1',
              thoughts: [],
              outline: { introduction: [], main: [], conclusion: [] },
              structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
            };
            const emptyResult = await getExportContent(emptySermon);
            expect(typeof emptyResult).toBe('string');

            const noThoughtsSermon: Sermon = {
              id: 'no-thoughts',
              title: 'No Thoughts Sermon',
              verse: '',
              date: '2024-01-01',
              userId: 'user1',
              thoughts: [],
              outline: { introduction: [], main: [], conclusion: [] },
              structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
            };
            const noThoughtsResult = await getExportContent(noThoughtsSermon);
            expect(noThoughtsResult).toContain('No Thoughts Sermon');
          },
        },
      ]);
    });

    it('supports structure, outline, and verse permutations without spawning dozens of tests', async () => {
      await runScenarios([
        {
          name: 'verse omissions',
          run: async () => {
            const noVerse = await getExportContent({ ...mockSermon, verse: '' });
            expect(noVerse).not.toContain('John 3:16');

            const emptyVerse = await getExportContent({ ...mockSermon, verse: '   ' });
            expect(emptyVerse).not.toContain('John 3:16');

            const whitespaceVerse = await getExportContent({ ...mockSermon, verse: '  \n  \n  ' });
            expect(whitespaceVerse).not.toContain('John 3:16');
          },
        },
        {
          name: 'complex verse content',
          run: async () => {
            const complexVerseSermon: Sermon = {
              ...mockSermon,
              verse: 'John 3:16\nFor God so loved the world\nThat he gave his only Son',
            };
            const result = await getExportContent(complexVerseSermon);
            expect(result).toContain('For God so loved the world');
          },
        },
        {
          name: 'outline permutations',
          run: async () => {
            const baseResult = await getExportContent(mockSermon);
            expect(baseResult).toContain('1. Introduction Point 1');
            expect(baseResult).toContain('First thought');
            const noOutline: Sermon = {
              ...mockSermon,
              outline: { introduction: [], main: [], conclusion: [] },
            };
            const resultNoOutline = await getExportContent(noOutline);
            expect(resultNoOutline).toContain('tags.introduction:');

            const mixedOutline: Sermon = {
              ...mockSermon,
              outline: { introduction: [{ id: 'point1', text: 'Intro Point' }], main: [], conclusion: [] },
            };
            const mixedResult = await getExportContent(mixedOutline);
            expect(mixedResult).toContain('1. Intro Point');
          },
        },
        {
          name: 'outline point respects position order',
          run: async () => {
            const positionSermon: Sermon = {
              ...mockSermon,
              thoughts: [
                {
                  id: 't-pos-first',
                  text: 'Position first',
                  tags: ['intro'],
                  date: '2024-01-03',
                  outlinePointId: 'point1',
                  position: -100,
                },
                {
                  id: 't-pos-second',
                  text: 'Position second',
                  tags: ['intro'],
                  date: '2024-01-01',
                  outlinePointId: 'point1',
                  position: 0,
                },
              ],
              outline: { introduction: [{ id: 'point1', text: 'Intro Point' }], main: [], conclusion: [] },
              structure: { introduction: ['t-pos-first', 't-pos-second'], main: [], conclusion: [], ambiguous: [] },
            };
            const result = await getExportContent(positionSermon);
            expect(result.indexOf('Position first')).toBeLessThan(result.indexOf('Position second'));
          },
        },
        {
          name: 'outline point respects structure order over position',
          run: async () => {
            const structureOrderSermon: Sermon = {
              ...mockSermon,
              thoughts: [
                {
                  id: 't-struct-first',
                  text: 'Structure first',
                  tags: ['intro'],
                  date: '2024-01-03',
                  outlinePointId: 'point1',
                  position: -100,
                },
                {
                  id: 't-struct-second',
                  text: 'Structure second',
                  tags: ['intro'],
                  date: '2024-01-01',
                  outlinePointId: 'point1',
                  position: 100,
                },
              ],
              outline: { introduction: [{ id: 'point1', text: 'Intro Point' }], main: [], conclusion: [] },
              structure: { introduction: ['t-struct-second', 't-struct-first'], main: [], conclusion: [], ambiguous: [] },
            };
            const result = await getExportContent(structureOrderSermon);
            expect(result.indexOf('Structure second')).toBeLessThan(result.indexOf('Structure first'));
          },
        },
        {
          name: 'structure order keeps known ids ahead of unknown ids',
          run: async () => {
            const partialStructureSermon: Sermon = {
              ...mockSermon,
              thoughts: [
                {
                  id: 't-struct-known',
                  text: 'Known in structure',
                  tags: ['intro'],
                  date: '2024-01-05',
                  outlinePointId: 'point1',
                  position: 50,
                },
                {
                  id: 't-struct-unknown',
                  text: 'Missing from structure',
                  tags: ['intro'],
                  date: '2024-01-01',
                  outlinePointId: 'point1',
                  position: -50,
                },
              ],
              outline: { introduction: [{ id: 'point1', text: 'Intro Point' }], main: [], conclusion: [] },
              structure: { introduction: ['t-struct-known'], main: [], conclusion: [], ambiguous: [] },
            };
            const result = await getExportContent(partialStructureSermon);
            expect(result.indexOf('Known in structure')).toBeLessThan(result.indexOf('Missing from structure'));
          },
        },
        {
          name: 'structure fallbacks and empty sections',
          run: async () => {
            const emptyThoughts = await getExportContent({ ...mockSermon, thoughts: [] });
            expect(typeof emptyThoughts).toBe('string');

            const noStructure = await getExportContent({
              ...mockSermon,
              structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
            });
            expect(typeof noStructure).toBe('string');

            const emptyStructure = await getExportContent({
              ...mockSermon,
              structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
            });
            expect(typeof emptyStructure).toBe('string');

            const emptyOutline = await getExportContent({
              ...mockSermon,
              outline: { introduction: [], main: [], conclusion: [] },
            });
            expect(typeof emptyOutline).toBe('string');
          },
        },
      ]);
    });

    it('covers thought/tag/date variations and markdown verse formatting in a single workflow', async () => {
      await runScenarios([
        {
          name: 'thought tag permutations',
          run: async () => {
            const thoughtsBase = mockSermon.thoughts!;
            const multiTagSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'multi', text: 'Multi-tag thought', tags: ['intro', 'main'], date: '2024-01-05' }],
            };
            expect(await getExportContent(multiTagSermon)).toContain('Multi-tag thought');

            const noTagSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'no-tag', text: 'No tag thought', tags: [], date: '2024-01-04' }],
            };
            expect(await getExportContent(noTagSermon)).toContain('No tag thought');

            const customTagSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'custom', text: 'Custom tag thought', tags: ['custom-tag'], date: '2024-01-05' }],
            };
            expect(await getExportContent(customTagSermon)).toContain('Custom tag thought');

            const emptyTagsSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'empty-tags', text: 'Empty tags thought', tags: [], date: '2024-01-06' }],
            };
            expect(await getExportContent(emptyTagsSermon)).toContain('Empty tags thought');

            const undefinedTagsSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'undefined-tags', text: 'Undefined tags thought', tags: undefined as any, date: '2024-01-07' }],
            };
            expect(await getExportContent(undefinedTagsSermon)).toContain('Undefined tags thought');

            const nullTagsSermon: Sermon = {
              ...mockSermon,
              thoughts: [...thoughtsBase, { id: 'null-tags', text: 'Null tags thought', tags: null as any, date: '2024-01-08' }],
            };
            expect(await getExportContent(nullTagsSermon)).toContain('Null tags thought');
          },
        },
        {
          name: 'outline assignments and date variations',
          run: async () => {
            const baseResult = await getExportContent(mockSermon);
            expect(baseResult).toContain('First thought');
            expect(baseResult).toContain('Second thought');

            const noDateSermon: Sermon = {
              ...mockSermon,
              thoughts: [...mockSermon.thoughts!, { id: 'no-date', text: 'No date thought', tags: ['intro'], date: '' }],
            };
            const noDateResult = await getExportContent(noDateSermon);
            expect(noDateResult).toContain('No date thought');

            const nullDateSermon: Sermon = {
              ...mockSermon,
              thoughts: [...mockSermon.thoughts!, { id: 'null-date', text: 'Null date thought', tags: ['intro'], date: null as any }],
            };
            expect(await getExportContent(nullDateSermon)).toContain('Null date thought');

            const invalidDateSermon: Sermon = {
              ...mockSermon,
              thoughts: [...mockSermon.thoughts!, { id: 'invalid-date', text: 'Invalid date thought', tags: ['intro'], date: 'invalid-date' as any }],
            };
            expect(await getExportContent(invalidDateSermon)).toContain('Invalid date thought');
          },
        },
        {
          name: 'markdown verse formatting combos',
          run: async () => {
            const complexVerseSermon: Sermon = {
              ...mockSermon,
              verse: 'John 3:16\nFor God so loved the world\nThat he gave his only Son',
            };
            const complexMarkdown = await getExportContent(complexVerseSermon, undefined, { format: 'markdown' });
            expect(complexMarkdown).toContain('> John 3:16');
            expect(complexMarkdown).toContain('> For God so loved the world');
            expect(complexMarkdown).toContain('> That he gave his only Son');

            const emptyVerseMarkdown = await getExportContent({ ...mockSermon, verse: '' }, undefined, { format: 'markdown' });
            expect(emptyVerseMarkdown).not.toContain('> ');

            const whitespaceMarkdown = await getExportContent({ ...mockSermon, verse: '  \n  \n  ' }, undefined, { format: 'markdown' });
            expect(whitespaceMarkdown).not.toContain('> ');

            const mixedVerseSermon: Sermon = {
              ...mockSermon,
              verse: 'John 3:16\n\nFor God so loved the world\n\nThat he gave his only Son',
            };
            const mixedMarkdown = await getExportContent(mixedVerseSermon, undefined, { format: 'markdown' });
            expect(mixedMarkdown).toContain('> For God so loved the world');
            expect(mixedMarkdown).toContain('> That he gave his only Son');
          },
        },
      ]);
    });

    it('numbers outline points continuously, renders sub-points as N.M, and restarts in focus mode', async () => {
      const numberedSermon: Sermon = {
        id: 'numbered',
        title: 'Numbered Sermon',
        verse: 'Ref 1:1',
        date: '2024-01-01',
        userId: 'user1',
        outline: {
          introduction: [{ id: 'i1', text: 'Intro point A' }],
          main: [
            {
              id: 'm1',
              text: 'Main point one',
              subPoints: [
                { id: 'sp1', text: 'Sub A', position: 0 },
                { id: 'sp2', text: 'Sub B', position: 1 },
              ],
            },
            { id: 'm2', text: 'Main point two' },
          ],
          conclusion: [{ id: 'c1', text: 'Conclusion point' }],
        },
        thoughts: [
          { id: 't-i1', text: 'Intro thought', tags: ['intro'], date: '2024-01-01', outlinePointId: 'i1' },
          { id: 't-m1a', text: 'Thought under Sub A', tags: ['main'], date: '2024-01-02', outlinePointId: 'm1', subPointId: 'sp1', position: 0 },
          { id: 't-m1b', text: 'Thought under Sub B', tags: ['main'], date: '2024-01-03', outlinePointId: 'm1', subPointId: 'sp2', position: 1 },
          { id: 't-m2', text: 'Direct thought on main two', tags: ['main'], date: '2024-01-04', outlinePointId: 'm2' },
          { id: 't-c1', text: 'Conclusion thought', tags: ['conclusion'], date: '2024-01-05', outlinePointId: 'c1' },
        ],
        structure: {
          introduction: ['t-i1'],
          main: ['t-m1a', 't-m1b', 't-m2'],
          conclusion: ['t-c1'],
          ambiguous: [],
        },
      };

      const result = await getExportContent(numberedSermon);

      // Continuous numbering across all sections: intro=1, main=2 & 3, conclusion=4.
      expect(result).toContain('1. Intro point A');
      expect(result).toContain('2. Main point one');
      expect(result).toContain('3. Main point two');
      expect(result).toContain('4. Conclusion point');

      // Sub-points are visible and numbered N.M under their parent point.
      expect(result).toContain('2.1 Sub A');
      expect(result).toContain('2.2 Sub B');

      // Thoughts are bulleted under their sub-point / point (not flattened away).
      expect(result).toContain('- Thought under Sub A');
      expect(result).toContain('- Thought under Sub B');
      expect(result).toContain('- Direct thought on main two');

      // Order: point -> its sub-points (in order) -> next point.
      expect(result.indexOf('2. Main point one')).toBeLessThan(result.indexOf('2.1 Sub A'));
      expect(result.indexOf('2.1 Sub A')).toBeLessThan(result.indexOf('2.2 Sub B'));
      expect(result.indexOf('2.2 Sub B')).toBeLessThan(result.indexOf('3. Main point two'));

      // Focus mode on a single section restarts numbering at 1 (only that section present).
      const focusedMain = await getExportContent(numberedSermon, 'main');
      expect(focusedMain).toContain('1. Main point one');
      expect(focusedMain).toContain('1.1 Sub A');
      expect(focusedMain).toContain('2. Main point two');
      expect(focusedMain).not.toContain('Intro point A');
      expect(focusedMain).not.toContain('Conclusion point');

      // Markdown keeps the same hierarchy via real headings (### point, #### sub-point)
      // so a markdown parser cannot collapse sub-points into the parent list item.
      const md = await getExportContent(numberedSermon, undefined, { format: 'markdown' });
      expect(md).toContain('### 2. Main point one');
      expect(md).toContain('#### 2.1 Sub A');
      expect(md).toContain('#### 2.2 Sub B');
      expect(md).toContain('- Thought under Sub A');
      expect(md).toContain('### 3. Main point two');
      // The point/sub-point numbers are literal heading text, never indented list markers.
      expect(md).not.toContain('   2.1 Sub A');
      expect(md.indexOf('### 2. Main point one')).toBeLessThan(md.indexOf('#### 2.1 Sub A'));
      expect(md.indexOf('#### 2.1 Sub A')).toBeLessThan(md.indexOf('### 3. Main point two'));
    });
  });
});
