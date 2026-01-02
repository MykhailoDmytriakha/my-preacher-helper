/**
 * Tests for Structured Output Polish Transcription
 *
 * These tests verify the AI-powered transcription polishing
 * that removes filler words and fixes grammar.
 */
import { polishTranscription } from '@clients/polishTranscription.structured';
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

describe('polishTranscription', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return polished text for Russian transcription with filler words', async () => {
        // Arrange
        const mockResponse = {
            polishedText: 'Я хотел сказать, что Бог есть любовь.',
            meaningPreserved: true,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        const result = await polishTranscription(
            'Ну эээ... я хотел сказать что Бог есть любовь, вот'
        );

        // Assert
        expect(result.success).toBe(true);
        expect(result.polishedText).toBe('Я хотел сказать, что Бог есть любовь.');
        expect(result.originalText).toBe('Ну эээ... я хотел сказать что Бог есть любовь, вот');
        expect(result.error).toBeNull();
    });

    it('should return polished text for English transcription', async () => {
        // Arrange
        const mockResponse = {
            polishedText: 'I wanted to say that God is love.',
            meaningPreserved: true,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        const result = await polishTranscription(
            'Um, so like, I wanted to say that, uh, God is love, you know?'
        );

        // Assert
        expect(result.success).toBe(true);
        expect(result.polishedText).toBe('I wanted to say that God is love.');
        expect(result.error).toBeNull();
    });

    it('should return error for empty transcription', async () => {
        // Act
        const result = await polishTranscription('   ');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
        expect(result.error).toBe('Transcription is empty');
        expect(structuredOutput.callWithStructuredOutput).not.toHaveBeenCalled();
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
        const result = await polishTranscription('Some transcription text');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
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
        const result = await polishTranscription('Some transcription text');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
        expect(result.error).toBe('API timeout');
    });

    it('should handle meaning not preserved', async () => {
        // Arrange - when the transcription is just filler words
        const mockResponse = {
            polishedText: '',
            meaningPreserved: false,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        const result = await polishTranscription('ну эээ... типа... вот');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
        expect(result.error).toBe('Could not preserve meaning while cleaning');
        expect(result.originalText).toBe('ну эээ... типа... вот');
    });

    it('should handle unexpected exceptions', async () => {
        // Arrange
        (structuredOutput.callWithStructuredOutput as jest.Mock).mockRejectedValue(
            new Error('Network error')
        );

        // Act
        const result = await polishTranscription('Some transcription');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
        expect(result.error).toBe('Network error');
    });

    it('should handle no data in response', async () => {
        // Arrange
        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: null,
            refusal: null,
            error: null,
        });

        // Act
        const result = await polishTranscription('Some transcription');

        // Assert
        expect(result.success).toBe(false);
        expect(result.polishedText).toBeNull();
        expect(result.error).toBe('No data received from AI');
    });

    it('should preserve original text in result', async () => {
        // Arrange
        const originalText = '  Текст с пробелами  ';
        const mockResponse = {
            polishedText: 'Текст с пробелами.',
            meaningPreserved: true,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        const result = await polishTranscription(originalText);

        // Assert
        expect(result.success).toBe(true);
        // Original text should be preserved as-is (not trimmed)
        expect(result.originalText).toBe(originalText);
        expect(result.polishedText).toBe('Текст с пробелами.');
    });

    it('should call AI with correct parameters', async () => {
        // Arrange
        const mockResponse = {
            polishedText: 'Polished text.',
            meaningPreserved: true,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        await polishTranscription('Test transcription');

        // Assert
        expect(structuredOutput.callWithStructuredOutput).toHaveBeenCalledWith(
            expect.stringContaining('text cleaning assistant'),
            expect.stringContaining('Test transcription'),
            expect.any(Object),
            expect.objectContaining({
                formatName: 'polishTranscription',
            })
        );
    });

    it('should include language and scripture rules in the system prompt', async () => {
        // Arrange
        const mockResponse = {
            polishedText: 'Polished text.',
            meaningPreserved: true,
        };

        (structuredOutput.callWithStructuredOutput as jest.Mock).mockResolvedValue({
            success: true,
            data: mockResponse,
            refusal: null,
            error: null,
        });

        // Act
        await polishTranscription('Test transcription');

        // Assert
        const callArgs = (structuredOutput.callWithStructuredOutput as jest.Mock).mock.calls[0];
        const systemPrompt = callArgs[0] as string;

        expect(systemPrompt).toContain('LANGUAGE RULE');
        expect(systemPrompt).toContain('You MUST respond in the SAME language as the input');
        expect(systemPrompt).toContain('SCRIPTURE QUOTES & REFERENCES');
        expect(systemPrompt).toContain('KJV');
        expect(systemPrompt).toContain('Russian Synodal');
        expect(systemPrompt).toContain('Ogienko');
    });
});
