/**
 * Tests for Structured Output Study Note Analysis
 * 
 * These tests verify the AI-powered study note analysis
 * that extracts title, scripture refs, and tags.
 */
import { analyzeStudyNote, AnalyzeStudyNoteResult } from '@clients/studyNote.structured';
import * as structuredOutput from '@clients/structuredOutput';

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
    expect(systemPrompt).toContain('Cyrillic');
    expect(systemPrompt).toContain('English');
  });
});

