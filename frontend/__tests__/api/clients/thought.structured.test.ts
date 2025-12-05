/**
 * Tests for Structured Output Thought Generation
 * 
 * These tests verify the new structured output implementation
 * for generating thoughts from transcriptions.
 */
import { generateThoughtStructured, GenerateThoughtResult } from '@clients/thought.structured';
import * as structuredOutput from '@clients/structuredOutput';
import { Sermon } from '@/models/models';

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

