// @ts-nocheck
import { getExportContent } from '@/utils/exportContent';
import type { Sermon, Thought, Structure, OutlinePoint } from '@/app/models/models';

// Mock the i18n instance
jest.mock('@locales/i18n', () => ({
  i18n: {
    t: (key: string, fallback: string) => {
      const translations: Record<string, string> = {
        'export.sermonTitle': 'Sermon: ',
        'export.scriptureText': 'Scripture Text: ',
        'export.tagsLabel': 'Tags: ',
        'export.otherThoughts': 'Other Thoughts',
        'export.multipleTagsThoughts': 'Thoughts with Multiple Tags',
        'export.unassignedThoughts': 'Unassigned Thoughts',
        'export.thoughts': 'Thoughts',
        'export.noEntries': 'No entries',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion'
      };
      return translations[key] || fallback || key;
    }
  }
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation((...args) => {
    // Disable noisy logs during test runs
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('getExportContent', () => {
  // Helper function to create a timestamp for a specified number of days ago
  const daysAgo = (days: number): string => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  };

  // Helper function to create a thought
  const createThought = (
    id: string,
    text: string,
    tags: string[],
    daysAgoCount: number,
    outlinePointId?: string
  ): Thought => ({
    id,
    text,
    tags,
    date: new Date(Date.now() - daysAgoCount * 24 * 60 * 60 * 1000).toISOString(),
    outlinePointId,
  });

  describe('with structured sermon', () => {
    it('should export content with structure in the correct order (plain text)', async () => {
      // Arrange
      const thoughts: Thought[] = [
        createThought('1', 'Introduction thought', ['Вступление'], 3),
        createThought('2', 'Main part thought 1', ['Основная часть'], 2),
        createThought('3', 'Main part thought 2', ['Основная часть', 'Custom Tag'], 1),
        createThought('4', 'Conclusion thought', ['Заключение'], 0),
        createThought('5', 'Ambiguous thought', [], 4), // This should go to 'Other Thoughts'
      ];

      const structure: Structure = {
        introduction: ['1'],
        main: ['2', '3'],
        conclusion: ['4'],
        ambiguous: [], // Explicitly empty
      };

      const sermon: Sermon = {
        id: 'structured123',
        title: 'Structured Sermon',
        verse: 'John 3:16',
        date: new Date().toISOString(),
        thoughts,
        structure,
        userId: 'user1'
      };

      // Act
      const result = await getExportContent(sermon);

      // Assert
      expect(result).toContain('Sermon: Structured Sermon');
      expect(result).toContain('Scripture Text:\nJohn 3:16'); // Ensure correct string literal

      // Check section presence and basic content
      expect(result).toContain('Introduction:');
      expect(result).toContain('- Introduction thought');
      expect(result).toContain('Tags: Вступление');

      expect(result).toContain('Main Part:');
      expect(result).toContain('- Main part thought 1');
      expect(result).toContain('Tags: Основная часть');
      expect(result).toContain('- Main part thought 2');
      expect(result).toContain('   Tags: Основная часть, Custom Tag');

      expect(result).toContain('Conclusion:');
      expect(result).toContain('- Conclusion thought');
      expect(result).toContain('Tags: Заключение');

      // Check that 'Other Thoughts' handles the ambiguous thought
      expect(result).toContain('Other Thoughts:');
      expect(result).toContain('- Ambiguous thought');
      // Ambiguous thoughts don't have section tags displayed this way
      // Ensure we are checking for the *absence* of the specific tag line format
      const otherSectionContent = result.substring(result.indexOf('Other Thoughts:'));
      expect(otherSectionContent).not.toContain('   Tags: ');

      // Rough order check
      const introIndex = result.indexOf('Introduction:');
      const mainIndex = result.indexOf('Main Part:');
      const conclusionIndex = result.indexOf('Conclusion:');
      const otherIndex = result.indexOf('Other Thoughts:');

      expect(introIndex).toBeLessThan(mainIndex);
      expect(mainIndex).toBeLessThan(conclusionIndex);
      expect(conclusionIndex).toBeLessThan(otherIndex);
    });

    it('should handle structure with empty sections', async () => {
      // Arrange
      const thoughts: Thought[] = [
        createThought('1', 'Introduction thought', ['Вступление'], 3),
        createThought('4', 'Conclusion thought', ['Заключение'], 0),
      ];

      const structure: Structure = {
        introduction: ['1'],
        main: [],
        conclusion: ['4'],
        ambiguous: []
      };

      const sermon: Sermon = {
        id: 'emptySection123',
        title: 'Empty Section Sermon',
        verse: 'Genesis 1:1',
        date: new Date().toISOString(),
        thoughts,
        structure,
        userId: 'user1'
      };

      // Act
      const result = await getExportContent(sermon);

      // Assert
      expect(result).toContain('Introduction:\n\n- Introduction thought');
      expect(result).toContain('---------------------\n\n');
      expect(result).not.toContain('Main Part:');
      expect(result).toContain('Conclusion:\n\n- Conclusion thought');
      expect(result).toContain('---------------------\n\n');
      expect(result).not.toContain('Other Thoughts:');
    });

    it('should include tags for custom tagged thoughts', async () => {
      // Arrange
      const thoughts: Thought[] = [
        createThought('3', 'Main part thought with tags', ['Основная часть', 'Custom Tag'], 1),
      ];

      const structure: Structure = {
        introduction: [],
        main: ['3'],
        conclusion: [],
        ambiguous: []
      };

      const sermon: Sermon = {
        id: '123',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: new Date().toISOString(),
        thoughts,
        structure,
        userId: 'user1'
      };

      // Act
      const result = await getExportContent(sermon);

      // Assert
      expect(result).toContain('Main Part:');
      expect(result).toContain('- Main part thought with tags');
      expect(result).toContain('Custom Tag');
    });
  });

  describe('with date-based sorting (no structure, no outline)', () => {
    it('should sort thoughts by date within tag-based sections', async () => {
      // Arrange
      const thoughts: Thought[] = [
        createThought('1', 'Intro 1 (Oldest)', ['Вступление'], 5),
        createThought('2', 'Main 1', ['Основная часть'], 4),
        createThought('3', 'Conclusion 1', ['Заключение'], 3),
        createThought('4', 'Main 2 (Newest)', ['Основная часть', 'Extra Tag'], 1),
        createThought('5', 'Ambiguous 1', [], 2),
        createThought('6', 'Multi-tag (Intro+Main)', ['Вступление', 'Основная часть'], 6), // Oldest overall, but multi-tag
        createThought('7', 'Ambiguous 2', [], 0), // Newest ambiguous
      ];

      const sermon: Sermon = {
        id: 'dateSort123',
        title: 'Date Sort Sermon',
        verse: 'Acts 2:38',
        date: new Date().toISOString(),
        thoughts,
        // No structure, No outline
        userId: 'user1'
      };

      // Act
      const result = await getExportContent(sermon);

      // Assert
      expect(result).toContain('Sermon: Date Sort Sermon');
      expect(result).toContain('Scripture Text:\nActs 2:38'); // Ensure correct string literal

      // Check multi-tag handling (appears first within its relevant sections)
      expect(result).toContain('Thoughts with Multiple Tags:');
      expect(result).toContain('- Multi-tag (Intro+Main)');
      expect(result).toContain('Tags: Вступление, Основная часть');

      // Check Introduction section - multi-tag first, then sorted by date
      expect(result).toContain('Introduction:');
      const introSection = result.substring(result.indexOf('Introduction:'), result.indexOf('Main Part:'));
      expect(introSection).toContain('Thoughts with Multiple Tags:');
      expect(introSection).toContain('- Multi-tag (Intro+Main)');
      expect(introSection).toContain('- Intro 1 (Oldest)');
      expect(introSection.indexOf('Thoughts with Multiple Tags:')).toBeLessThan(introSection.indexOf('- Intro 1 (Oldest)'));

      // Check Main Part section - multi-tag first, then sorted by date
      expect(result).toContain('Main Part:');
      const mainSection = result.substring(result.indexOf('Main Part:'), result.indexOf('Conclusion:'));
      expect(mainSection).toContain('Thoughts with Multiple Tags:');
      expect(mainSection).toContain('- Multi-tag (Intro+Main)');
      expect(mainSection).toContain('- Main 1');
      expect(mainSection).toContain('- Main 2 (Newest)');
      expect(mainSection.indexOf('Thoughts with Multiple Tags:')).toBeLessThan(mainSection.indexOf('- Multi-tag (Intro+Main)'));
      expect(mainSection.indexOf('- Multi-tag (Intro+Main)')).toBeLessThan(mainSection.indexOf('- Main 1'));
      expect(mainSection.indexOf('- Main 1')).toBeLessThan(mainSection.indexOf('- Main 2 (Newest)'));
      expect(mainSection).toContain('Tags: Основная часть, Extra Tag');

      // Check Conclusion section
      expect(result).toContain('Conclusion:');
      const conclusionSection = result.substring(result.indexOf('Conclusion:'), result.indexOf('Other Thoughts:'));
      expect(conclusionSection).toContain('- Conclusion 1');

      // Check Other Thoughts section (ambiguous thoughts, sorted by date)
      expect(result).toContain('Other Thoughts:');
      const otherSection = result.substring(result.indexOf('Other Thoughts:'));
      expect(otherSection).toContain('- Ambiguous 1');
      expect(otherSection).toContain('- Ambiguous 2');
      expect(otherSection.indexOf('- Ambiguous 1')).toBeLessThan(otherSection.indexOf('- Ambiguous 2'));
    });

    it('should handle sermon with no verse', async () => {
      const sermon: Sermon = { id: 'noVerse', title: 'No Verse Sermon', verse: '', date: '', thoughts: [], userId: '' };
      const result = await getExportContent(sermon);
      expect(result).toContain('Sermon: No Verse Sermon');
      expect(result).not.toContain('Scripture Text:');
    });

    it('should handle sermon with whitespace verse', async () => {
      const sermon: Sermon = { id: 'wsVerse', title: 'Whitespace Verse Sermon', verse: '  \n ', date: '', thoughts: [], userId: '' };
      const result = await getExportContent(sermon);
      expect(result).toContain('Sermon: Whitespace Verse Sermon');
      expect(result).not.toContain('Scripture Text:');
    });

    it('should handle sermon with no thoughts', async () => {
      // Arrange
      const sermon: Sermon = {
        id: 'noThoughts123',
        title: 'No Thoughts Sermon',
        verse: 'John 1:1',
        date: new Date().toISOString(),
        thoughts: [], // Empty thoughts array
        userId: 'user1'
      };

      // Act
      const result = await getExportContent(sermon);

      // Assert
      expect(result).toContain('Sermon: No Thoughts Sermon');
      expect(result).toContain('Scripture Text:\nJohn 1:1'); // Ensure correct string literal
      expect(result).not.toContain('Introduction:');
      expect(result).not.toContain('Main Part:');
      expect(result).not.toContain('Conclusion:');
      expect(result).not.toContain('Other Thoughts:');
      expect(result).not.toContain('No entries'); // Since sections are skipped
      expect(result.trim()).toBe(`Sermon: No Thoughts Sermon
Scripture Text:
John 1:1`); // Use backticks for multiline check
    });
  });

  describe('with outline points', () => {
    it('should group thoughts by outline points', async () => {
       // Arrange
       const outlinePoints: OutlinePoint[] = [
         { id: 'op1', text: 'Opening Point' },
         { id: 'op2', text: 'Second Point' },
         { id: 'op3', text: 'Closing Point' },
       ];

       const thoughts: Thought[] = [
         createThought('t1', 'Thought for Opening', ['Вступление'], 3, 'op1'),
         createThought('t2', 'Thought for Second Pt', ['Основная часть'], 2, 'op2'),
         createThought('t3', 'Another Opening Thought', ['Вступление'], 1, 'op1'),
         createThought('t4', 'Thought for Main Arg 1', ['Основная часть'], 4), // No outline ID
         createThought('t5', 'Unassigned Intro Thought', ['Вступление'], 5), // No outline ID
         createThought('t6', 'Unassigned Ambiguous', [], 0), // No outline ID, no section tag
       ];

       const sermon: Sermon = {
         id: 'outline123',
         title: 'Outline Sermon',
         verse: 'Psalm 23:1',
         date: new Date().toISOString(),
         thoughts,
         outline: {
           introduction: [outlinePoints[0]], // op1
           main: [outlinePoints[1]],         // op2
           conclusion: [outlinePoints[2]],   // op3 (no thoughts assigned)
         },
         userId: 'user1'
       };

       // Act
       const result = await getExportContent(sermon);

       // Assert
       expect(result).toContain('Sermon: Outline Sermon');
       expect(result).toContain('Scripture Text:\nPsalm 23:1'); // Ensure correct string literal

       // Check Introduction Section
       expect(result).toContain('Introduction:');
       const introSection = result.substring(result.indexOf('Introduction:'), result.indexOf('Main Part:'));
       expect(introSection).toContain('Opening Point:');
       expect(introSection).toContain('- Thought for Opening');
       expect(introSection).toContain('- Another Opening Thought');
       expect(introSection).toContain('Unassigned Thoughts:');
       expect(introSection).toContain('- Unassigned Intro Thought');
       expect(introSection.indexOf('Opening Point:')).toBeLessThan(introSection.indexOf('Unassigned Thoughts:'));

       // Check Main Section
       expect(result).toContain('Main Part:');
       // Adjust substring extraction to end before 'Other Thoughts:' since 'Conclusion:' is skipped
       const conclusionIndex = result.indexOf('Conclusion:'); // Might be -1
       const otherThoughtsIndex = result.indexOf('Other Thoughts:');
       const mainSectionEndIndex = conclusionIndex !== -1 ? conclusionIndex : otherThoughtsIndex;
       const mainSection = result.substring(result.indexOf('Main Part:'), mainSectionEndIndex);

       expect(mainSection).toContain('Second Point:');
       expect(mainSection).toContain('- Thought for Second Pt');
       expect(mainSection).toContain('Unassigned Thoughts:');
       expect(mainSection).toContain('- Thought for Main Arg 1');
       expect(mainSection).toContain('Tags: Основная часть');

       // Check Conclusion Section - Skipped
       expect(result).not.toContain('Conclusion:');

       // Check Other Thoughts Section
       expect(result).toContain('Other Thoughts:');
       const otherSection = result.substring(result.indexOf('Other Thoughts:'));
       // Corrected: The ambiguous section processing creates a block with the same title as the section,
       // so the block title "Unassigned Thoughts:" is NOT printed according to formatPlainText logic.
       expect(otherSection).not.toContain('Unassigned Thoughts:'); // It should NOT contain this block title
       expect(otherSection).toContain('- Unassigned Ambiguous'); // It should contain the thought directly
    });
  });

  describe('export options and edge cases', () => {
    it('should exclude metadata when includeMetadata is false', async () => {
      const thoughts = [createThought('t1', 'A thought', [], 1)];
      const sermon: Sermon = { id: 'meta', title: 'Meta Test', verse: 'V1', date: '', thoughts, userId: '' };
      const result = await getExportContent(sermon, undefined, { includeMetadata: false });
      expect(result).not.toContain('Sermon: Meta Test');
      expect(result).not.toContain('Scripture Text:');
      expect(result).toContain('Other Thoughts:\n\n- A thought');
    });

    it('should exclude tags when includeTags is false', async () => {
      const thoughts = [createThought('t1', 'A thought with tags', ['Tag1', 'Tag2'], 1)];
      const sermon: Sermon = { id: 'tags', title: 'Tags Test', verse: 'V1', date: '', thoughts, userId: '' };
      const result = await getExportContent(sermon, undefined, { includeTags: false });
      expect(result).toContain('- A thought with tags');
      expect(result).not.toContain('Tags: Tag1, Tag2');
      expect(result).not.toContain('Tags: ');
    });

    it('should export in markdown format', async () => {
      // Arrange
      const thoughts: Thought[] = [
        createThought('1', 'Intro', ['Вступление'], 5),
        createThought('2', 'Main point 1', ['Основная часть'], 4),
        createThought('3', 'Conclusion', ['Заключение'], 3),
        createThought('4', 'Main point 2 with *markdown*', ['Основная часть', 'Code'], 1),
        createThought('5', 'Ambiguous', [], 2),
        createThought('6', 'Multi', ['Вступление', 'Заключение'], 6),
      ];
      const sermon: Sermon = {
        id: 'md123', title: 'Markdown Sermon', verse: 'Line1\nLine2', date: '', thoughts, userId: ''
      };

      // Act
      const result = await getExportContent(sermon, undefined, { format: 'markdown' });

      // Assert
      expect(result).toContain('# Sermon: Markdown Sermon');
      expect(result).toContain(`**Scripture Text:**\n> Line1\n> \n> Line2`); 

      // Section Titles (H2)
      expect(result).toContain('## Introduction');
      expect(result).toContain('## Main Part');
      expect(result).toContain('## Conclusion');
      expect(result).toContain('## Other Thoughts');

      // Block Titles (H3) - e.g., for multi-tag
      expect(result).toContain('### Thoughts with Multiple Tags');

      // Thoughts (Numbered list)
      expect(result).toContain('1. Intro');
      expect(result).toContain('1. Main point 1');
      expect(result).toContain('2. Main point 2 with *markdown*'); // Content preserved
      expect(result).toContain('1. Conclusion');
      expect(result).toContain('1. Ambiguous');
      expect(result).toContain('1. Multi');

      // Tags (Indented, Italicized)
      expect(result).toContain('   *Tags: Вступление*');
      expect(result).toContain('   *Tags: Основная часть*');
      // Corrected expectation for tag formatting
      expect(result).toContain('   *Tags: Основная часть, Code*\n');
      expect(result).toContain('   *Tags: Заключение*');
      expect(result).toContain('   *Tags: Вступление, Заключение*'); // Multi-tag

      // Separators (Markdown HR)
      expect(result).toContain('---\n\n');
    });

     it('should handle empty blocks gracefully in markdown', async () => {
      const thoughts: Thought[] = [
        createThought('1', 'Intro', ['Вступление'], 1),
        createThought('3', 'Conclusion', ['Заключение'], 0),
      ];
       const sermon: Sermon = { id: 'mdEmpty', title: 'MD Empty', verse: '', thoughts, userId: '' };
       const result = await getExportContent(sermon, undefined, { format: 'markdown' });

       expect(result).toContain('## Introduction\n\n');
       expect(result).toContain('1. Intro');
       expect(result).toContain('---\n\n');
       expect(result).not.toContain('## Main Part');
       expect(result).toContain('## Conclusion\n\n');
       expect(result).toContain('1. Conclusion');
       expect(result).toContain('---\n\n');
       expect(result).not.toContain('_No entries_');
     });

  });

  describe('complete output verification', () => {
    it('should produce exact output for minimal valid sermon (plain)', async () => {
      const sermon: Sermon = {
        id: 'minPlain', title: 'Minimal Plain', verse: 'Gen 1:1', date: '', thoughts: [], userId: ''
      };
      // Corrected expected output based on current logic (only header)
      const expected = `Sermon: Minimal Plain
Scripture Text:
Gen 1:1`; // Use backticks, remove trailing newline for trim comparison
      expect((await getExportContent(sermon)).trim()).toBe(expected.trim());
    });

    it('should produce exact output for minimal valid sermon (markdown)', async () => {
       const sermon: Sermon = {
         id: 'minMD',
         title: 'Minimal MD',
         verse: 'Gen 1:1', // Test setup has single line verse
         date: '', thoughts: [], userId: ''
       };
       // Corrected expected output to match single line verse from setup
       const expected = `# Sermon: Minimal MD

**Scripture Text:**
> Gen 1:1`; // Removed '> Line 2'
       expect((await getExportContent(sermon, undefined, { format: 'markdown' })).trim()).toBe(expected.trim());
    });

    it('should produce exact output for full structured sermon (plain)', async () => {
      const thoughts: Thought[] = [
        createThought('1', 'Intro', ['Вступление'], 1),
        createThought('2', 'Main', ['Основная часть'], 1),
        createThought('3', 'Conclusion', ['Заключение'], 1),
        createThought('4', 'Other', [], 1), // Ambiguous
        createThought('5', 'Multi', ['Вступление', 'Основная часть'], 2), // Multi-tag
      ];

      const sermon: Sermon = {
        id: 'fullPlain',
        title: 'Full Plain',
        verse: 'Rev 22:21',
        date: '', thoughts,
        structure: { introduction: ['1'], main: ['2'], conclusion: ['3'], ambiguous: [] }, // Define structure
        userId: ''
      };

      // Updated expected output based on current formatting and organization
      const expected = `Sermon: Full Plain
Scripture Text:
Rev 22:21

Introduction:

Thoughts with Multiple Tags:

- Multi
   Tags: Вступление, Основная часть

---------------------

- Intro
   Tags: Вступление

---------------------

Main Part:

Thoughts with Multiple Tags:

- Multi
   Tags: Вступление, Основная часть

---------------------

- Main
   Tags: Основная часть

---------------------

Conclusion:

- Conclusion
   Tags: Заключение

---------------------

Other Thoughts:

- Other

---------------------

`; // Use backticks for multiline string
      const result = await getExportContent(sermon);
      // Correctly escape newlines in replace arguments
      expect(result.replace(/\r\n/g, '\n')).toBe(expected.replace(/\r\n/g, '\n'));
    });

    it('should produce exact output for full structured sermon (markdown)', async () => {
      const thoughts: Thought[] = [
        createThought('1', 'Intro', ['Вступление'], 1),
        createThought('2', 'Main', ['Основная часть'], 1),
        createThought('3', 'Conclusion', ['Заключение'], 1),
        createThought('4', 'Other', [], 1), // Ambiguous
        createThought('5', 'Multi', ['Вступление', 'Основная часть'], 2), // Multi-tag
      ];

      const sermon: Sermon = {
        id: 'fullMD',
        title: 'Full MD',
        verse: 'Rev 22:21',
        date: '', thoughts,
        structure: { introduction: ['1'], main: ['2'], conclusion: ['3'], ambiguous: [] }, // Define structure
        userId: ''
      };

      // Updated expected output for Markdown based on current formatting
      const expected = `# Sermon: Full MD

**Scripture Text:**
> Rev 22:21

## Introduction

### Thoughts with Multiple Tags

1. Multi
   *Tags: Вступление, Основная часть*

---

1. Intro
   *Tags: Вступление*

---

## Main Part

### Thoughts with Multiple Tags

1. Multi
   *Tags: Вступление, Основная часть*

---

1. Main
   *Tags: Основная часть*

---

## Conclusion

1. Conclusion
   *Tags: Заключение*

---

## Other Thoughts

1. Other

---

`; // Use backticks for multiline string
      const result = await getExportContent(sermon, undefined, { format: 'markdown' });
      // Correctly escape newlines in replace arguments
      expect(result.replace(/\r\n/g, '\n')).toBe(expected.replace(/\r\n/g, '\n'));
    });

  });

  // --- NEW TESTS FOR MARKDOWN VERSE FORMATTING --- 
  describe('Markdown formatting', () => {
    describe('Verse formatting', () => {
      const baseSermon: Omit<Sermon, 'verse'> = {
        id: 'mdVerseTest123',
        title: 'Markdown Verse Test',
        date: new Date().toISOString(),
        thoughts: [], // Not relevant for these tests
        userId: 'userMd'
      };

      it('should handle sermons with no verse', async () => {
        const sermon: Sermon = { ...baseSermon, verse: undefined };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        expect(result).toContain('# Sermon: Markdown Verse Test');
        expect(result).not.toContain('**Scripture Text:**');
        expect(result).not.toContain('> '); // No blockquote should be present
      });

      it('should format a single-line verse', async () => {
        const sermon: Sermon = { ...baseSermon, verse: 'John 3:16' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        expect(result).toContain('**Scripture Text:**\n> John 3:16\n\n');
      });

      it('should format a multi-line verse with internal newlines (\n)', async () => {
        const sermon: Sermon = { ...baseSermon, verse: 'Line 1\nLine 2\nLine 3' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        // Expect internal newlines to be joined with \n> \n for visual paragraph breaks
        expect(result).toContain('**Scripture Text:**\n> Line 1\n> \n> Line 2\n> \n> Line 3\n\n');
      });

      it('should format multiple verses separated by single newlines (\n)', async () => {
        const sermon: Sermon = { ...baseSermon, verse: 'Verse 1 Reference\nVerse 2 Reference' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        // Expect verses separated by \n to be joined with \n> \n for visual paragraph breaks
        expect(result).toContain('**Scripture Text:**\n> Verse 1 Reference\n> \n> Verse 2 Reference\n\n');
      });

      it('should format multiple verses separated by double newlines (\n\n)', async () => {
        const sermon: Sermon = { ...baseSermon, verse: 'Verse A Paragraph\n\nVerse B Paragraph' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        // Expect verses separated by \n\n to also be joined with \n> \n for visual paragraph breaks
        expect(result).toContain('**Scripture Text:**\n> Verse A Paragraph\n> \n> Verse B Paragraph\n\n');
      });
      
      it('should handle verse text with leading/trailing whitespace', async () => {
        const sermon: Sermon = { ...baseSermon, verse: '  \n  Trimmed Verse \n  ' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
         // Whitespace is trimmed, leaving only the core verse line
        expect(result).toContain('**Scripture Text:**\n> Trimmed Verse\n\n');
      });

      it('should handle verse text with internal double newlines and whitespace', async () => {
        const sermon: Sermon = { ...baseSermon, verse: '  Line Alpha  \n\n  Line Beta  \n\n' };
        const result = await getExportContent(sermon, undefined, { format: 'markdown' });
        // Should trim whitespace around lines and handle double newlines correctly
        expect(result).toContain('**Scripture Text:**\n> Line Alpha\n> \n> Line Beta\n\n');
      });

    });
    // Add other Markdown formatting tests here if needed
  });
  // --- END OF NEW TESTS --- 
}); 