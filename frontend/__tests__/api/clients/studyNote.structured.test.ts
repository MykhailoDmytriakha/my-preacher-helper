/**
 * Tests for Structured Output Study Note Analysis
 * 
 * These tests verify the AI-powered study note analysis
 * that extracts title, scripture refs, and tags.
 */
import * as structuredOutput from '@clients/structuredOutput';
import { analyzeStudyNote } from '@clients/studyNote.structured';

// Mock the structuredOutput module
jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

// Mock the openAIHelpers logger
jest.mock('@clients/openAIHelpers', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
}));

describe('analyzeStudyNote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return successful analysis for Russian content', async () => {
    // Arrange
    const mockResponse = {
      title: 'Блаженства в Нагорной проповеди',
      scriptureRefs: [
        { book: 'Matthew', chapter: 5, fromVerse: 1, toVerse: 12 },
        { book: 'Isaiah', chapter: 61, fromVerse: 1, toVerse: 2 },
      ],
      tags: ['Нагорная проповедь', 'Пророчества'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote(
      'В Матфея 5:1-12 Иисус учит о блаженствах. Это перекликается с Исаией 61:1-2.'
    );

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Блаженства в Нагорной проповеди');
    expect(result.data?.scriptureRefs).toHaveLength(2);
    expect(result.data?.scriptureRefs[0].book).toBe('Matthew');
    expect(result.data?.tags).toContain('Нагорная проповедь');
  });

  it('should return successful analysis for English content', async () => {
    // Arrange
    const mockResponse = {
      title: 'Beatitudes in the Sermon on the Mount',
      scriptureRefs: [
        { book: 'Matthew', chapter: 5, fromVerse: 1, toVerse: 12 },
      ],
      tags: ['Sermon on the Mount', 'Jesus Teaching'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote(
      'In Matthew 5:1-12 Jesus teaches about the beatitudes.'
    );

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Beatitudes in the Sermon on the Mount');
    expect(result.data?.tags).toContain('Sermon on the Mount');
  });

  it('should return error for empty content', async () => {
    // Act
    const result = await analyzeStudyNote('   ');

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toBe('Note content is empty');
    expect(structuredOutput.callWithStructuredOutput).not.toHaveBeenCalled();
  });

  it('should pass existing tags to the AI', async () => {
    // Arrange
    const existingTags = ['Евангелия', 'Христология'];

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        title: 'Test',
        scriptureRefs: [],
        tags: ['Евангелия'],
      },
      refusal: null,
      error: null,
    });

    // Act
    await analyzeStudyNote('Test content', existingTags);

    // Assert
    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Евангелия'),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should handle AI refusal', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: 'Content policy violation',
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain('AI refused');
  });

  it('should handle AI error', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('API timeout'),
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toBe('API timeout');
  });

  it('should filter invalid scripture refs', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Matthew', chapter: 5, fromVerse: 1 }, // Valid
        { book: '', chapter: 5, fromVerse: 1 }, // Invalid: no book
        { book: 'John', chapter: 0, fromVerse: 1 }, // Invalid: chapter 0
        { book: 'Luke', chapter: 1, fromVerse: 0 }, // Invalid: verse 0
        { book: 'Mark', chapter: 1, fromVerse: 5, toVerse: 3 }, // Invalid: toVerse < fromVerse
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0].book).toBe('Matthew');
  });

  it('should remove toVerse when it equals fromVerse (single verse)', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Joel', chapter: 2, fromVerse: 1, toVerse: 1 }, // Should become just fromVerse: 1
        { book: 'Matthew', chapter: 5, fromVerse: 1, toVerse: 12 }, // Should keep range
        { book: 'Romans', chapter: 6, fromVerse: 6, toVerse: 6 }, // Should become just fromVerse: 6
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(3);

    // Joel 2:1 - toVerse should be removed
    expect(result.data?.scriptureRefs[0]).toEqual({
      book: 'Joel',
      chapter: 2,
      fromVerse: 1,
    });
    expect(result.data?.scriptureRefs[0]).not.toHaveProperty('toVerse');

    // Matthew 5:1-12 - should keep range
    expect(result.data?.scriptureRefs[1]).toEqual({
      book: 'Matthew',
      chapter: 5,
      fromVerse: 1,
      toVerse: 12,
    });

    // Romans 6:6 - toVerse should be removed
    expect(result.data?.scriptureRefs[2]).toEqual({
      book: 'Romans',
      chapter: 6,
      fromVerse: 6,
    });
    expect(result.data?.scriptureRefs[2]).not.toHaveProperty('toVerse');
  });

  it('should detect Cyrillic language and include language directive', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: { title: 'Тест', scriptureRefs: [], tags: [] },
      refusal: null,
      error: null,
    });

    // Act
    await analyzeStudyNote('Текст на русском языке о Библии');

    // Assert
    const callArgs = (structuredOutput.callWithStructuredOutput as jest.Mock).mock.calls[0];
    const systemPrompt = callArgs[0];
    // Language detection correctly identifies Russian text (contains 'Russian' directive)
    expect(systemPrompt).toContain('Russian');
    expect(systemPrompt).toContain('English');
  });

  // New tests for flexible Scripture reference types

  it('should accept book-only references', async () => {
    // Arrange
    const mockResponse = {
      title: 'Study of Ezekiel',
      scriptureRefs: [
        { book: 'Ezekiel' }, // Book-only: valid
      ],
      tags: ['Prophecy'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('A study about the book of Ezekiel');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0]).toEqual({ book: 'Ezekiel' });
  });

  it('should accept chapter-only references', async () => {
    // Arrange
    const mockResponse = {
      title: 'Romans 8 Study',
      scriptureRefs: [
        { book: 'Romans', chapter: 8 }, // Chapter-only: valid
      ],
      tags: ['Salvation'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('A deep study of Romans chapter 8');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0]).toEqual({ book: 'Romans', chapter: 8 });
  });

  it('should accept chapter-range references', async () => {
    // Arrange
    const mockResponse = {
      title: 'Sermon on the Mount',
      scriptureRefs: [
        { book: 'Matthew', chapter: 5, toChapter: 7 }, // Chapter range: valid
      ],
      tags: ['Sermon on Mount'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('The Sermon on the Mount in Matthew 5-7');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0]).toEqual({
      book: 'Matthew',
      chapter: 5,
      toChapter: 7,
    });
  });

  it('should filter out invalid chapter-range where toChapter < chapter', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Matthew', chapter: 7, toChapter: 5 }, // Invalid: toChapter < chapter
        { book: 'Romans', chapter: 8 }, // Valid
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0].book).toBe('Romans');
  });

  it('should filter out references with toChapter but no chapter', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Matthew', toChapter: 7 }, // Invalid: toChapter without chapter
        { book: 'Ezekiel' }, // Valid: book-only
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0]).toEqual({ book: 'Ezekiel' });
  });

  it('should remove toChapter when it equals chapter (single chapter, not a range)', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Romans', chapter: 8, toChapter: 8 }, // Should become just chapter: 8
        { book: 'Matthew', chapter: 5, toChapter: 7 }, // Should keep range
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(2);

    // Romans 8 - toChapter should be removed
    expect(result.data?.scriptureRefs[0]).toEqual({
      book: 'Romans',
      chapter: 8,
    });
    expect(result.data?.scriptureRefs[0]).not.toHaveProperty('toChapter');

    // Matthew 5-7 - should keep range
    expect(result.data?.scriptureRefs[1]).toEqual({
      book: 'Matthew',
      chapter: 5,
      toChapter: 7,
    });
  });

  it('should remove redundant toChapter even when toVerse is collapsed', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'Hebrews', chapter: 10, toChapter: 10, fromVerse: 22, toVerse: 22 },
        { book: 'Exodus', chapter: 13, toChapter: 13, fromVerse: 19, toVerse: 19 },
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toEqual([
      { book: 'Hebrews', chapter: 10, fromVerse: 22 },
      { book: 'Exodus', chapter: 13, fromVerse: 19 },
    ]);
  });

  it('should accept mixed reference types in same analysis', async () => {
    // Arrange - simulating the Ezekiel example from JSDOC
    const mockResponse = {
      title: 'Glory of God in Ezekiel',
      scriptureRefs: [
        { book: 'Ezekiel' }, // Book-only
        { book: 'Ezekiel', chapter: 1 }, // Chapter-only
        { book: 'Ezekiel', chapter: 10, toChapter: 11 }, // Chapter range
        { book: 'Ezekiel', chapter: 40, toChapter: 48 }, // Chapter range
      ],
      tags: ['Glory', 'Temple'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote(
      'Книга Иезекииля... видение славы в начале (глава 1)... слава отошла (главы 10-11)... в конце храм (главы 40-48)'
    );

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(4);
    expect(result.data?.scriptureRefs[0]).toEqual({ book: 'Ezekiel' });
    expect(result.data?.scriptureRefs[1]).toEqual({ book: 'Ezekiel', chapter: 1 });
    expect(result.data?.scriptureRefs[2]).toEqual({ book: 'Ezekiel', chapter: 10, toChapter: 11 });
    expect(result.data?.scriptureRefs[3]).toEqual({ book: 'Ezekiel', chapter: 40, toChapter: 48 });
  });

  it('should filter out references with fromVerse but no chapter', async () => {
    // Arrange
    const mockResponse = {
      title: 'Test',
      scriptureRefs: [
        { book: 'John', fromVerse: 16 }, // Invalid: fromVerse without chapter
        { book: 'John', chapter: 3, fromVerse: 16 }, // Valid
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test content');

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.scriptureRefs).toHaveLength(1);
    expect(result.data?.scriptureRefs[0]).toEqual({
      book: 'John',
      chapter: 3,
      fromVerse: 16,
    });
  });
  it('should deduplicate identical references', async () => {
    // Arrange
    const mockResponse = {
      title: 'Duplicate Test',
      scriptureRefs: [
        { book: 'Daniel', chapter: 1, fromVerse: 9, toVerse: 9 },
        { book: 'Daniel', chapter: 1, fromVerse: 9, toVerse: 9 }, // Duplicate
        { book: 'Daniel', chapter: 1, fromVerse: 9, toVerse: 9 }, // Duplicate
        { book: 'Matthew', chapter: 5 },
        { book: 'Matthew', chapter: 5 }, // Duplicate
      ],
      tags: ['Test'],
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test duplication');

    // Assert
    expect(result.success).toBe(true);
    // Should have 2 unique refs: Daniel 1:9 and Matthew 5
    expect(result.data?.scriptureRefs).toHaveLength(2);

    // Verify specific unique references exist
    const danielRef = result.data?.scriptureRefs.find(r => r.book === 'Daniel');
    expect(danielRef).toEqual({
      book: 'Daniel',
      chapter: 1,
      fromVerse: 9,
    });

    const matthewRef = result.data?.scriptureRefs.find(r => r.book === 'Matthew');
    expect(matthewRef).toEqual({
      book: 'Matthew',
      chapter: 5
    });
  });

  it('should deduplicate identical tags', async () => {
    // Arrange
    const mockResponse = {
      title: 'Tag Duplication Test',
      scriptureRefs: [
        { book: 'Daniel', chapter: 1 },
      ],
      tags: ['Даниил', 'компромиссы', 'Даниил', 'духовная жизнь', 'компромиссы'], // Duplicates
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await analyzeStudyNote('Test tag duplication');

    // Assert
    expect(result.success).toBe(true);
    // Should have 3 unique tags: Даниил, компромиссы, духовная жизнь
    expect(result.data?.tags).toHaveLength(3);
    expect(result.data?.tags).toEqual(
      expect.arrayContaining(['Даниил', 'компромиссы', 'духовная жизнь'])
    );
    // Verify no duplicates
    const uniqueTags = new Set(result.data?.tags);
    expect(uniqueTags.size).toBe(result.data?.tags.length);
  });

  it('should include CRITICAL book name mappings in prompt for Russian notes', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: { 
        title: 'Тест', 
        scriptureRefs: [{ book: '2 Samuel', chapter: 7 }], 
        tags: ['Давид'] 
      },
      refusal: null,
      error: null,
    });

    // Act
    await analyzeStudyNote('Во 2 Царств 7 главе...');

    // Assert - verify prompt contains critical mappings
    const callArgs = (structuredOutput.callWithStructuredOutput as jest.Mock).mock.calls[0];
    const systemPrompt = callArgs[0];
    
    // Check that prompt includes book name mapping table
    expect(systemPrompt).toContain('CRITICAL BOOK NAME MAPPINGS');
    expect(systemPrompt).toContain('1 Царств');
    expect(systemPrompt).toContain('1 Samuel');
    expect(systemPrompt).toContain('2 Samuel');
    expect(systemPrompt).toContain('NOT "2 Kings"');
    
    // Check that prompt includes Psalm conversion rules
    expect(systemPrompt).toContain('PSALM NUMBERING CONVERSION');
    expect(systemPrompt).toContain('Septuagint → Hebrew');
  });
});

