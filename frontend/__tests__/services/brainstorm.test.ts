import fetchMock from 'jest-fetch-mock';

import { BrainstormSuggestion } from '@/models/models';

// Mock the fetch API
fetchMock.enableMocks();

// Hard code the API URL for testing instead of using environment variable
const API_URL = 'http://localhost:3000';

describe('brainstorm.service', () => {
  let generateBrainstormSuggestion: any;

  beforeEach(() => {
    fetchMock.resetMocks();
    jest.clearAllMocks();
    
    // Set up environment variable before importing
    process.env.NEXT_PUBLIC_API_BASE = API_URL;
    
    // Suppress console.log for cleaner test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Import fresh module each time
    jest.resetModules();
    const brainstormService = require('@/services/brainstorm.service');
    generateBrainstormSuggestion = brainstormService.generateBrainstormSuggestion;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Restore the environment variable
    process.env.NEXT_PUBLIC_API_BASE = API_URL;
  });

  const mockSermonId = 'test-sermon-123';
  
  const mockBrainstormSuggestion: BrainstormSuggestion = {
    id: 'bs-test-123',
    text: 'Consider exploring the historical context of this passage and how it might have sounded to the original audience.',
    type: 'context'
  };

  const mockSuccessResponse = {
    suggestion: mockBrainstormSuggestion
  };

  describe('generateBrainstormSuggestion', () => {
    it('successfully generates brainstorm suggestion', async () => {
      // Arrange
      fetchMock.mockResponseOnce(JSON.stringify(mockSuccessResponse), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      // Act
      const result = await generateBrainstormSuggestion(mockSermonId);

      // Assert
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_URL}/api/sermons/${mockSermonId}/brainstorm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      expect(result).toEqual(mockBrainstormSuggestion);
    });

    it('handles API error responses gracefully', async () => {
      // Arrange
      const errorResponse = { error: 'Failed to generate brainstorm suggestion' };
      fetchMock.mockResponseOnce(JSON.stringify(errorResponse), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });

      // Act & Assert
      await expect(generateBrainstormSuggestion(mockSermonId))
        .rejects.toThrow('Brainstorm generation failed');
    });

    it('handles network errors gracefully', async () => {
      // Arrange
      fetchMock.mockRejectOnce(new Error('Network error'));

      // Act & Assert
      await expect(generateBrainstormSuggestion(mockSermonId))
        .rejects.toThrow('Network error');
    });

    it('handles non-ok status codes', async () => {
      // Arrange
      fetchMock.mockResponseOnce('Not Found', { 
        status: 404,
        statusText: 'Not Found'
      });

      // Act & Assert
      await expect(generateBrainstormSuggestion(mockSermonId))
        .rejects.toThrow('Brainstorm generation failed');
    });

    it('handles empty response gracefully', async () => {
      // Arrange
      fetchMock.mockResponseOnce(JSON.stringify({}), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      // Act
      const result = await generateBrainstormSuggestion(mockSermonId);

      // Assert - service returns whatever is in response.suggestion (could be undefined)
      expect(result).toBeUndefined();
    });

    it('handles malformed JSON response', async () => {
      // Arrange
      fetchMock.mockResponseOnce('invalid json', { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      // Act & Assert
      await expect(generateBrainstormSuggestion(mockSermonId))
        .rejects.toThrow();
    });

    it('handles missing NEXT_PUBLIC_API_BASE environment variable', async () => {
      // Arrange - clear environment variable and re-import module
      delete process.env.NEXT_PUBLIC_API_BASE;
      jest.resetModules();
      const brainstormService = require('@/services/brainstorm.service');
      const testFunction = brainstormService.generateBrainstormSuggestion;

      // Mock response for undefined URL
      fetchMock.mockResponseOnce(JSON.stringify(mockSuccessResponse), { status: 200 });
      
      // Act
      const result = await testFunction(mockSermonId);

      // Assert - verify the URL was constructed with undefined and function still works
      expect(fetchMock).toHaveBeenCalledWith(
        `undefined/api/sermons/${mockSermonId}/brainstorm`,
        expect.any(Object)
      );
      expect(result).toEqual(mockBrainstormSuggestion);
    });

    it('validates suggestion object structure', async () => {
      // Arrange - response with incomplete suggestion
      const incompleteResponse = {
        suggestion: {
          id: 'test-id',
          // Missing text and type
        }
      };
      
      fetchMock.mockResponseOnce(JSON.stringify(incompleteResponse), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      // Act
      const result = await generateBrainstormSuggestion(mockSermonId);

      // Assert - service returns whatever is in response.suggestion
      expect(result).toEqual(incompleteResponse.suggestion);
    });

    it('handles different suggestion types correctly', async () => {
      const suggestionTypes: Array<BrainstormSuggestion['type']> = [
        'text', 'question', 'context', 'reflection', 'relationship', 'application'
      ];

      for (const type of suggestionTypes) {
        // Arrange
        const suggestion: BrainstormSuggestion = {
          id: `bs-${type}-test`,
          text: `Test ${type} suggestion`,
          type
        };
        
        const response = { suggestion };
        
        fetchMock.mockResponseOnce(JSON.stringify(response), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        // Act
        const result = await generateBrainstormSuggestion(mockSermonId);

        // Assert
        expect(result).toEqual(suggestion);
        expect(result.type).toBe(type);
        
        fetchMock.resetMocks();
      }
    });

    it('constructs correct API URL with sermonId', async () => {
      // Arrange
      const customSermonId = 'custom-sermon-456';
      fetchMock.mockResponseOnce(JSON.stringify(mockSuccessResponse));

      // Act
      await generateBrainstormSuggestion(customSermonId);

      // Assert
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_URL}/api/sermons/${customSermonId}/brainstorm`,
        expect.any(Object)
      );
    });

    it('sets correct headers for API request', async () => {
      // Arrange
      fetchMock.mockResponseOnce(JSON.stringify(mockSuccessResponse));

      // Act
      await generateBrainstormSuggestion(mockSermonId);

      // Assert
      const [, options] = fetchMock.mock.calls[0];
      expect(options).toEqual({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('logs appropriate messages during execution', async () => {
      // Restore console mocks for this test
      jest.restoreAllMocks();
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      // Arrange
      fetchMock.mockResponseOnce(JSON.stringify(mockSuccessResponse));

      // Act
      await generateBrainstormSuggestion(mockSermonId);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        'generateBrainstormSuggestion: Starting brainstorm generation for sermon:',
        mockSermonId
      );
      expect(logSpy).toHaveBeenCalledWith(
        'generateBrainstormSuggestion: Received response:',
        200
      );
      expect(logSpy).toHaveBeenCalledWith(
        'generateBrainstormSuggestion: Generation succeeded. Suggestion:',
        mockBrainstormSuggestion
      );
      
      logSpy.mockRestore();
    });

    it('logs errors when they occur', async () => {
      // Restore console mocks for this test
      jest.restoreAllMocks();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Arrange
      fetchMock.mockResponseOnce('', { status: 500 });

      // Act
      try {
        await generateBrainstormSuggestion(mockSermonId);
      } catch {
        // Expected to throw
      }

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        'generateBrainstormSuggestion: Generation failed with status',
        500
      );
      
      errorSpy.mockRestore();
    });
  });
}); 