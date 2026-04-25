/**
 * Tests for Structured Output Thought Generation
 * 
 * These tests verify the new structured output implementation
 * for generating thoughts from transcriptions.
 */
import { Sermon } from '@/models/models';
import * as structuredOutput from '@clients/structuredOutput';
import { generateThoughtStructured } from '@clients/thought.structured';

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

describe('generateThoughtStructured', () => {
  const mockSermon: Sermon = {
    id: 'sermon-123',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    userId: 'user-123',
    thoughts: [],
    structure: { introduction: [], main: [], conclusion: [] },
    outline: { introduction: [], main: [], conclusion: [] },
  };

  const availableTags = ['Вступление', 'Основная часть', 'Заключение'];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEBUG_MODE = 'false';
  });

  afterAll(() => {
    delete process.env.DEBUG_MODE;
  });

  it('should log debug info when DEBUG_MODE is true', async () => {
    await jest.isolateModules(async () => {
      // Arrange
      process.env.DEBUG_MODE = 'true';
      const { generateThoughtStructured } = require('@clients/thought.structured');
      const structuredOutput = require('@clients/structuredOutput');
      const { logger } = require('@clients/openAIHelpers');

      const mockResponse = {
        originalText: 'Test transcription',
        formattedText: 'Formatted',
        tags: ['Вступление'],
        meaningPreserved: true,
      };

      (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
        success: true,
        data: mockResponse,
        refusal: null,
        error: null,
      });

      // Act
      await generateThoughtStructured(
        'Test transcription',
        mockSermon,
        availableTags
      );

      // Assert
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  it('should trim content preview in debug log when content is very long', async () => {
    await jest.isolateModules(async () => {
      process.env.DEBUG_MODE = 'true';
      const { generateThoughtStructured } = require('@clients/thought.structured');
      const structuredOutput = require('@clients/structuredOutput');
      const { logger } = require('@clients/openAIHelpers');

      const longContent = 'A'.repeat(301);
      const mockResponse = {
        originalText: longContent,
        formattedText: 'Formatted',
        tags: ['Вступление'],
        meaningPreserved: true,
      };

      (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
        success: true,
        data: mockResponse,
        refusal: null,
        error: null,
      });

      await generateThoughtStructured(longContent, mockSermon, availableTags);

      expect(logger.debug).toHaveBeenCalledWith(
        'GenerateThoughtStructured',
        'Starting generation',
        expect.objectContaining({
          contentPreview: expect.stringContaining('...'),
        })
      );
      expect(logger.debug.mock.calls[0][2].contentPreview.length).toBeLessThanOrEqual(303);
    });
  });

  it('should return successful result when meaning is preserved', async () => {
    // Arrange
    const mockResponse = {
      originalText: 'Test transcription',
      formattedText: 'Formatted test transcription',
      tags: ['Вступление'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await generateThoughtStructured(
      'Test transcription',
      mockSermon,
      availableTags
    );

    // Assert
    expect(result.meaningSuccessfullyPreserved).toBe(true);
    expect(result.formattedText).toBe('Formatted test transcription');
    expect(result.tags).toEqual(['Вступление']);
    expect(result.originalText).toBe('Test transcription');
    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        formatName: 'thought',
        promptBlueprint: expect.objectContaining({
          promptName: 'thought',
          promptVersion: 'v5',
        }),
      })
    );
  });

  it('should instruct the model not to inject the sermon main verse when it was not dictated', async () => {
    const sermonWithMainVerse: Sermon = {
      ...mockSermon,
      title: 'Свидетельство о поисках работы',
      verse: 'Прит. 3:5-6',
      thoughts: [
        {
          id: 'existing-thought-1',
          text: 'A'.repeat(320),
          tags: ['Вступление'],
          date: '2024-01-01',
        },
      ],
    };
    const dictatedText = 'Поиск работы занял чуть больше месяца, и это было большим чудом.';
    const mockResponse = {
      originalText: 'AI-mutated original text',
      formattedText: 'Поиск работы занял чуть больше месяца, и это было большим чудом.',
      tags: ['Вступление'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    const result = await generateThoughtStructured(
      dictatedText,
      sermonWithMainVerse,
      availableTags
    );

    const [systemPrompt, userMessage, , options] = (structuredOutput.callWithStructuredOutput as jest.Mock).mock.calls[0];
    expect(systemPrompt).toContain('DO NOT add the main sermon scripture reference');
    expect(systemPrompt).toContain('Do not use the sermon main scripture from the context as an added citation');
    expect(systemPrompt).toContain('Bible references are helpful when they are grounded in the dictated words');
    expect(systemPrompt).toContain('Bad thematic additions');
    expect(userMessage).toContain('только для понимания и тегов');
    expect(userMessage).toContain('не добавляй эти данные в мысль');
    expect(userMessage).toContain('Основной текст проповеди: Прит. 3:5-6');
    expect(userMessage).toContain(`Мысль: "${'A'.repeat(300)}…`);
    expect(options).toEqual(
      expect.objectContaining({
        promptBlueprint: expect.objectContaining({
          promptVersion: 'v5',
        }),
      })
    );
    expect(result.originalText).toBe(dictatedText);
  });

  it('should retry when the model injects the main sermon reference from context', async () => {
    const sermonWithMainVerse: Sermon = {
      ...mockSermon,
      title: 'Доверие Богу',
      verse: 'Прит. 3:5-6',
    };
    const dictatedText = 'Поиск работы занял чуть больше месяца, и это было большим чудом.';

    (structuredOutput.callWithStructuredOutput as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        data: {
          originalText: dictatedText,
          formattedText: 'Поиск работы занял чуть больше месяца, и это было большим чудом (Прит. 3:5-6).',
          tags: ['Вступление'],
          meaningPreserved: true,
        },
        refusal: null,
        error: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          originalText: dictatedText,
          formattedText: 'Поиск работы занял чуть больше месяца, и это было большим чудом.',
          tags: ['Вступление'],
          meaningPreserved: true,
        },
        refusal: null,
        error: null,
      });

    const result = await generateThoughtStructured(
      dictatedText,
      sermonWithMainVerse,
      availableTags
    );

    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledTimes(2);
    expect(result.meaningSuccessfullyPreserved).toBe(true);
    expect(result.formattedText).toBe('Поиск работы занял чуть больше месяца, и это было большим чудом.');
  });

  it('should allow the main sermon reference when the user dictated it', async () => {
    const sermonWithMainVerse: Sermon = {
      ...mockSermon,
      title: 'Доверие Богу',
      verse: 'Прит. 3:5-6',
    };
    const dictatedText = 'Прочитаем Притчи 3 глава 5 стих и посмотрим на доверие Богу.';

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        originalText: dictatedText,
        formattedText: 'Прочитаем Прит. 3:5 и посмотрим на доверие Богу.',
        tags: ['Основная часть'],
        meaningPreserved: true,
      },
      refusal: null,
      error: null,
    });

    const result = await generateThoughtStructured(
      dictatedText,
      sermonWithMainVerse,
      availableTags
    );

    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledTimes(1);
    expect(result.meaningSuccessfullyPreserved).toBe(true);
    expect(result.formattedText).toBe('Прочитаем Прит. 3:5 и посмотрим на доверие Богу.');
  });

  it('should normalize dictated Scripture references in formatted thought text', async () => {
    const mockResponse = {
      originalText: 'Нужно прочитать Второзаконие 10 глава 11 стих',
      formattedText: 'Нужно прочитать Второзаконие 10 глава 11 стих.',
      tags: ['Основная часть'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    const result = await generateThoughtStructured(
      'Нужно прочитать Второзаконие 10 глава 11 стих',
      mockSermon,
      availableTags
    );

    expect(result.meaningSuccessfullyPreserved).toBe(true);
    expect(result.formattedText).toBe('Нужно прочитать Втор. 10:11.');
    expect(result.originalText).toBe('Нужно прочитать Второзаконие 10 глава 11 стих');
  });

  it('should apply force tag when provided', async () => {
    // Arrange
    const mockResponse = {
      originalText: 'Test transcription',
      formattedText: 'Formatted text',
      tags: ['Вступление'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await generateThoughtStructured(
      'Test transcription',
      mockSermon,
      availableTags,
      { forceTag: 'Заключение' }
    );

    // Assert
    expect(result.tags).toEqual(['Заключение']);
    expect(result.meaningSuccessfullyPreserved).toBe(true);
  });

  it('should return failure result when model refuses', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: 'Content policy violation',
      error: null,
    });

    // Act
    const result = await generateThoughtStructured(
      'Test transcription',
      mockSermon,
      availableTags
    );

    // Assert
    expect(result.meaningSuccessfullyPreserved).toBe(false);
    expect(result.formattedText).toBeNull();
    expect(result.tags).toBeNull();
    expect(result.originalText).toBe('Test transcription');
  });

  it('should return failure result on error', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('API error'),
    });

    // Act
    const result = await generateThoughtStructured(
      'Test transcription',
      mockSermon,
      availableTags
    );

    // Assert
    expect(result.meaningSuccessfullyPreserved).toBe(false);
    expect(result.formattedText).toBeNull();
    expect(result.tags).toBeNull();
  });

  it('should catch errors in runThoughtAttempt', async () => {
    // Arrange
    (structuredOutput.callWithStructuredOutput as jest.Mock).mockRejectedValue(new Error('Fatal error'));

    // Act
    const result = await generateThoughtStructured(
      'Test transcription',
      mockSermon,
      availableTags
    );

    // Assert
    expect(result.meaningSuccessfullyPreserved).toBe(false);
  });

  it('should retry when meaning is not preserved', async () => {
    // Arrange
    const notPreservedResponse = {
      originalText: 'Test',
      formattedText: 'Changed',
      tags: ['Вступление'],
      meaningPreserved: false,
    };

    const preservedResponse = {
      originalText: 'Test',
      formattedText: 'Good format',
      tags: ['Основная часть'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        data: notPreservedResponse,
        refusal: null,
        error: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: preservedResponse,
        refusal: null,
        error: null,
      });

    // Act
    const result = await generateThoughtStructured(
      'Test',
      mockSermon,
      availableTags,
      { maxRetries: 3 }
    );

    // Assert
    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledTimes(2);
    expect(result.meaningSuccessfullyPreserved).toBe(true);
    expect(result.formattedText).toBe('Good format');
  });

  it('should return failure after max retries exhausted', async () => {
    // Arrange
    const notPreservedResponse = {
      originalText: 'Test',
      formattedText: 'Changed',
      tags: ['Вступление'],
      meaningPreserved: false,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: notPreservedResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await generateThoughtStructured(
      'Test',
      mockSermon,
      availableTags,
      { maxRetries: 2 }
    );

    // Assert
    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledTimes(2);
    expect(result.meaningSuccessfullyPreserved).toBe(false);
  });

  it('should fail immediately on invalid response structure', async () => {
    // Arrange
    const invalidResponse = {
      originalText: 'Test',
      formattedText: '', // Empty - invalid
      tags: ['Вступление'],
      meaningPreserved: true,
    };

    (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: invalidResponse,
      refusal: null,
      error: null,
    });

    // Act
    const result = await generateThoughtStructured(
      'Test',
      mockSermon,
      availableTags
    );

    // Assert
    // Should not retry on invalid structure - fail immediately
    expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledTimes(1);
    expect(result.meaningSuccessfullyPreserved).toBe(false);
  });
});
