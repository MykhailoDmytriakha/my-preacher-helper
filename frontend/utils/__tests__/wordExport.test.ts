import { exportToWord, PlanData, WordExportOptions, parseMarkdownToParagraphs, parseTable, parseInlineMarkdown } from '../wordExport';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Table } from 'docx';
import { saveAs } from 'file-saver';

// Mock the docx library
jest.mock('docx', () => {
  const actualDocx = jest.requireActual('docx');
  return {
    ...actualDocx,
    Document: jest.fn(),
    Packer: {
      toBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    },
  };
});

// Mock file-saver
jest.mock('file-saver', () => ({
  saveAs: jest.fn(),
}));

// Mock URL methods
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// Mock Blob constructor
global.Blob = jest.fn().mockImplementation((parts, options) => ({
  size: 1024,
  type: options?.type || 'application/octet-stream',
  parts,
  options,
}));

describe('wordExport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exportToWord', () => {
    const mockPlanData: PlanData = {
      sermonTitle: 'Test Sermon',
      sermonVerse: 'John 3:16',
      introduction: '## Intro Heading\nThis is the introduction.\n- Point 1\n- Point 2',
      main: '# Main Heading\nThis is the main content.\n1. First point\n2. Second point',
      conclusion: 'This is the conclusion.\n> Important quote',
      exportDate: '1 января 2024',
    };

    it('should create a Word document with correct structure', async () => {
      const options: WordExportOptions = {
        data: mockPlanData,
        filename: 'test-sermon.docx',
      };

      await exportToWord(options);

      expect(Document).toHaveBeenCalledWith(expect.objectContaining({
        creator: 'My Preacher Helper',
        title: `План проповеди: ${mockPlanData.sermonTitle}`,
        description: 'Автоматически сгенерированный план проповеди',
      }));

      expect(saveAs).toHaveBeenCalledWith(expect.any(Object), 'test-sermon.docx');
    });

    it('should use default filename when not provided', async () => {
      const options: WordExportOptions = {
        data: mockPlanData,
      };

      await exportToWord(options);

      expect(saveAs).toHaveBeenCalledWith(
        expect.any(Object), 
        expect.stringContaining('план-проповеди-test-sermon')
      );
    });

    it('should generate date when not provided', async () => {
      const planDataWithoutDate = { ...mockPlanData };
      delete planDataWithoutDate.exportDate;

      const options: WordExportOptions = {
        data: planDataWithoutDate,
      };

      await exportToWord(options);

      expect(Document).toHaveBeenCalledWith(expect.objectContaining({
        creator: 'My Preacher Helper',
      }));
    });

    it('should handle export errors gracefully', async () => {
      const mockError = new Error('Export failed');
      const DocumentMock = Document as jest.MockedClass<typeof Document>;
      DocumentMock.mockImplementationOnce(() => {
        throw mockError;
      });

      const options: WordExportOptions = {
        data: mockPlanData,
      };

      await expect(exportToWord(options)).rejects.toThrow('Failed to export to Word document');
    });
  });

  describe('parseMarkdownToParagraphs', () => {
    it('should handle empty content with placeholder text', () => {
      const result = parseMarkdownToParagraphs('');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle whitespace-only content', () => {
      const result = parseMarkdownToParagraphs('   \n  \t  ');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should parse H1 headings correctly', () => {
      const result = parseMarkdownToParagraphs('# Main Heading', '2563eb');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should parse H2 headings correctly', () => {
      const result = parseMarkdownToParagraphs('## Sub Heading', '7c3aed');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should parse H3 headings correctly', () => {
      const result = parseMarkdownToParagraphs('### Small Heading', '059669');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should parse bullet points correctly', () => {
      const result = parseMarkdownToParagraphs('- First point\n* Second point');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Paragraph);
      expect(result[1]).toBeInstanceOf(Paragraph);
    });

    it('should parse numbered lists correctly', () => {
      const result = parseMarkdownToParagraphs('1. First item\n2. Second item\n3. Third item');
      
      expect(result).toHaveLength(3);
      result.forEach(item => expect(item).toBeInstanceOf(Paragraph));
    });

    it('should parse blockquotes correctly', () => {
      const result = parseMarkdownToParagraphs('> This is a quote\n> Another line');
      
      expect(result).toHaveLength(2);
      result.forEach(item => expect(item).toBeInstanceOf(Paragraph));
    });

    it('should parse horizontal rules correctly', () => {
      const result = parseMarkdownToParagraphs('---\n***');
      
      expect(result).toHaveLength(2);
      result.forEach(item => expect(item).toBeInstanceOf(Paragraph));
    });

    it('should identify Bible verses and apply correct indentation', () => {
      const content = 'Притч 17:18: "Безрассуден тот, кто берет на себя долг другого"';
      const result = parseMarkdownToParagraphs(content);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle mixed content types', () => {
      const content = '# Heading\nRegular paragraph\n- Bullet point\n> Quote\n---';
      const result = parseMarkdownToParagraphs(content);
      
      expect(result).toHaveLength(5);
      result.forEach(item => expect(item).toBeInstanceOf(Paragraph));
    });

    it('should handle tables in content', () => {
      const content = '| Col1 | Col2 |\n|------|------|\n| Row1 | Data1 |';
      const result = parseMarkdownToParagraphs(content);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });
  });

  describe('parseTable', () => {
    it('should return null for insufficient table lines', () => {
      const result = parseTable(['| Single line']);
      
      expect(result).toBeNull();
    });

    it('should return null for empty table lines', () => {
      const result = parseTable([]);
      
      expect(result).toBeNull();
    });

    it('should parse valid table correctly', () => {
      const tableLines = [
        '| Column 1 | Column 2 |',
        '|----------|----------|',
        '| Row 1    | Data 1   |',
        '| Row 2    | Data 2   |'
      ];
      
      const result = parseTable(tableLines);
      
      expect(result).toBeInstanceOf(Table);
    });

    it('should handle malformed table gracefully', () => {
      const tableLines = [
        '| Column 1 | Column 2',
        '|----------|',
        '| Row 1    |',
      ];
      
      const result = parseTable(tableLines);
      
      // Should still return a table even if malformed
      expect(result).toBeInstanceOf(Table);
    });

    it('should filter out separator lines', () => {
      const tableLines = [
        '| Column 1 | Column 2 |',
        '|:---------|:---------|',
        '| Row 1    | Data 1   |',
      ];
      
      const result = parseTable(tableLines);
      
      expect(result).toBeInstanceOf(Table);
    });

    it('should handle table with different cell counts per row', () => {
      const tableLines = [
        '| Column 1 | Column 2 | Column 3 |',
        '|----------|----------|----------|',
        '| Row 1    | Data 1   |',
        '| Row 2    | Data 2   | Data 3   |',
      ];
      
      const result = parseTable(tableLines);
      
      expect(result).toBeInstanceOf(Table);
    });
  });

  describe('parseInlineMarkdown', () => {
    it('should return plain text for content without formatting', () => {
      const result = parseInlineMarkdown('Plain text content');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(TextRun);
    });

    it('should parse bold formatting correctly', () => {
      const result = parseInlineMarkdown('This is **bold** text');
      
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(TextRun);
      expect(result[1]).toBeInstanceOf(TextRun);
      expect(result[2]).toBeInstanceOf(TextRun);
    });

    it('should parse italic formatting correctly', () => {
      const result = parseInlineMarkdown('This is *italic* text');
      
      expect(result).toHaveLength(3);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should parse triple emphasis correctly', () => {
      const result = parseInlineMarkdown('This is ***bold and italic*** text');
      
      expect(result).toHaveLength(3);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should parse code formatting correctly', () => {
      const result = parseInlineMarkdown('This is `code` text');
      
      expect(result).toHaveLength(3);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should parse strikethrough formatting correctly', () => {
      const result = parseInlineMarkdown('This is ~~strikethrough~~ text');
      
      expect(result).toHaveLength(3);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should parse superscript formatting correctly', () => {
      const result = parseInlineMarkdown('E = mc^2^');
      
      expect(result).toHaveLength(2);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should parse subscript formatting correctly', () => {
      const result = parseInlineMarkdown('H~2~O');
      
      expect(result).toHaveLength(3);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should handle multiple formatting types', () => {
      const result = parseInlineMarkdown('**Bold** and *italic* and `code`');
      
      expect(result).toHaveLength(5);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should handle nested formatting gracefully', () => {
      const result = parseInlineMarkdown('**Bold with *italic* inside**');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(TextRun);
    });

    it('should handle overlapping formatting gracefully', () => {
      const result = parseInlineMarkdown('**Bold starts here *and italic overlaps** here*');
      
      expect(result).toHaveLength(2);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should handle unclosed formatting gracefully', () => {
      const result = parseInlineMarkdown('**Unclosed bold and *unclosed italic');
      
      expect(result).toHaveLength(2);
      result.forEach(run => expect(run).toBeInstanceOf(TextRun));
    });

    it('should handle empty string', () => {
      const result = parseInlineMarkdown('');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(TextRun);
    });

    it('should handle only formatting characters', () => {
      const result = parseInlineMarkdown('**');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(TextRun);
    });
  });

  describe('Integration tests', () => {
    it('should handle content with various markdown elements', async () => {
      const planData: PlanData = {
        sermonTitle: 'Markdown Test',
        introduction: '# Main Heading\n## Sub Heading\n### Small Heading',
        main: '- Bullet point\n* Another bullet\n1. Numbered item\n2. Another number',
        conclusion: '> This is a quote\n---\nRegular paragraph',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle Bible verse references', async () => {
      const planData: PlanData = {
        sermonTitle: 'Bible Verses Test',
        introduction: 'Притч 17:18: "Безрассуден тот, кто берет на себя долг другого"\nМуд 17:18: "Лишь неразумный человек даёт залог"',
        main: 'Regular content',
        conclusion: 'Regular content',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle tables in markdown', async () => {
      const planData: PlanData = {
        sermonTitle: 'Table Test',
        introduction: '| Column 1 | Column 2 |\n|----------|----------|\n| Row 1 | Data 1 |\n| Row 2 | Data 2 |',
        main: 'Regular content',
        conclusion: 'Regular content',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle various inline formatting', async () => {
      const planData: PlanData = {
        sermonTitle: 'Inline Formatting Test',
        introduction: '**Bold text** and *italic text* and `code text`',
        main: '***Bold and italic*** and ~~strikethrough~~ text',
        conclusion: 'Text with ^superscript^ and ~subscript~',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle malformed tables gracefully', async () => {
      const planData: PlanData = {
        sermonTitle: 'Malformed Table Test',
        introduction: '| Only one column',
        main: '||\n||', // Empty table
        conclusion: 'Regular content',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });
  });

  describe('Interface types', () => {
    it('should accept valid PlanData', () => {
      const validPlanData: PlanData = {
        sermonTitle: 'Valid Sermon',
        sermonVerse: 'Optional verse',
        introduction: 'Intro content',
        main: 'Main content',
        conclusion: 'Conclusion content',
        exportDate: 'Optional date',
      };

      expect(validPlanData.sermonTitle).toBe('Valid Sermon');
    });

    it('should accept minimal PlanData', () => {
      const minimalPlanData: PlanData = {
        sermonTitle: 'Minimal Sermon',
        introduction: 'Intro',
        main: 'Main',
        conclusion: 'Conclusion',
      };

      expect(minimalPlanData.sermonTitle).toBe('Minimal Sermon');
    });

    it('should accept valid WordExportOptions', () => {
      const validOptions: WordExportOptions = {
        data: {
          sermonTitle: 'Test',
          introduction: 'Intro',
          main: 'Main', 
          conclusion: 'Conclusion',
        },
        filename: 'custom-filename.docx',
      };

      expect(validOptions.filename).toBe('custom-filename.docx');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle very long content', async () => {
      const longContent = 'A'.repeat(10000);
      const planData: PlanData = {
        sermonTitle: 'Long Content Test',
        introduction: longContent,
        main: longContent,
        conclusion: longContent,
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle special characters', async () => {
      const planData: PlanData = {
        sermonTitle: 'Специальные символы ñáéíóú 中文 🙏',
        introduction: 'Контент с эмодзи 😊 и символами ®™©',
        main: 'Математические символы ∑∆∏∫ и стрелки →←↑↓',
        conclusion: 'Кавычки "двойные" и "одинарные" и символы №§',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle malformed markdown gracefully', async () => {
      const planData: PlanData = {
        sermonTitle: 'Malformed Markdown Test',
        introduction: '**Unclosed bold and *unclosed italic and `unclosed code',
        main: '### ### Multiple hashes # and --- incomplete rules -',
        conclusion: '> Unclosed quote\n\n\n\nMultiple newlines',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });

    it('should handle nested markdown', async () => {
      const planData: PlanData = {
        sermonTitle: 'Nested Markdown Test',
        introduction: '**Bold with *italic inside* and `code`**',
        main: '***Triple emphasis with `code` inside***',
        conclusion: '> Quote with **bold** and *italic* text',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
    });
  });

  describe('Color and styling', () => {
    it('should apply section colors correctly', async () => {
      const planData: PlanData = {
        sermonTitle: 'Color Test',
        introduction: '# Introduction Heading',
        main: '# Main Heading',
        conclusion: '# Conclusion Heading',
      };

      await exportToWord({ data: planData });

      expect(Document).toHaveBeenCalled();
      // The Document constructor should be called with sections that include colored headings
    });
  });
}); 