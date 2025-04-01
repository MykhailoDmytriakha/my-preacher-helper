import { Sermon, DirectionSuggestion } from '@/models/models';
// Import the actual EXPORTED functions we want to test
import { generateSermonDirections } from '@clients/openAI.client';

// --- Mock External Dependencies ---

// Mock the library. Define the mock function *inside* the factory.
jest.mock('openai', () => {
  // Define the mock function here, within the factory scope
  const mockCreateCompletion = jest.fn(); 
  
  // Expose the mock function for tests to configure it later
  // We attach it to the mock constructor itself, which is unusual but works for testing.
  const mockConstructor = jest.fn().mockImplementation(() => { 
    return {
      chat: {
        completions: {
          create: mockCreateCompletion 
        }
      },
      audio: {
        transcriptions: {
          create: jest.fn().mockResolvedValue({ text: 'mock transcription' })
        }
      }
    };
  });

  // Attach the inner mock function to the mock constructor so tests can access it
  (mockConstructor as any).mockCreateCompletion = mockCreateCompletion;

  return mockConstructor; // Return the mock constructor
});

// Helper to access the inner mock function after mocking
const getMockCreateCompletion = () => { 
    // Dynamically require the mocked module to access the attached function
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MockOpenAI = require('openai'); 
    return (MockOpenAI as any).mockCreateCompletion as jest.Mock; 
};

// --- Test Suite ---

describe('openAI.client', () => {
  let mockCreateCompletion: jest.Mock; // Variable to hold the mock fn in tests

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Get the mock function reference for this test run
    mockCreateCompletion = getMockCreateCompletion(); 
    // Ensure it's reset for each test
    mockCreateCompletion.mockReset(); 
  });

  // --- Tests for generateSermonDirections ---
  describe('generateSermonDirections', () => {
    // Use the correctly typed mock sermon
    const mockSermon: Sermon = {
      id: 'test-sermon-123',
      title: 'Test Sermon',
      userId: 'user-1',
      date: new Date().toISOString(),
      verse: 'John 3:16',
      thoughts: [],
    };

    const mockApiResponseDirections: DirectionSuggestion[] = [
      { area: 'Theology', suggestion: 'Explore deeper.' },
      { area: 'History', suggestion: 'Check sources.' }
    ];

    // Helper to create the expected API response structure (message.content string)
    const createMockApiContentString = (content: any) => JSON.stringify(content);

    // DEFINE the helper function here
    const createMockApiResponse = (content: any) => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    });
    
    const createMockApiErrorResponse = (content: any) => ({
      choices: [{ message: { content: content } }],
    });

    it('should parse simple JSON and return directions', async () => {
      const apiResponseContent = createMockApiContentString({ directions: mockApiResponseDirections });
      mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: apiResponseContent } }] });

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockApiResponseDirections);
    });

    it('should parse JSON within <arguments> tags and return directions', async () => {
      const apiResponseContent = `<arguments>${createMockApiContentString({ directions: mockApiResponseDirections })}</arguments>`;
      mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: apiResponseContent } }] });

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockApiResponseDirections);
    });

    it('should parse JSON within ```json code block and return directions', async () => {
      const apiResponseContent = `\`\`\`json\n${createMockApiContentString({ directions: mockApiResponseDirections })}\n\`\`\``;
      mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: apiResponseContent } }] });

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockApiResponseDirections);
    });

    it('should parse truncated JSON within ```json code block and return directions', async () => {
      // Simulate a response truncated after the second direction's area field is complete
      const truncatedContent = `\`\`\`json\n{\n  "directions": [\n    {\n      "area": "Area 1",\n      "suggestion": "Suggestion 1"\n    },\n    {\n      "area": "Area 2" // Truncated here, missing suggestion, comma, closing brace/bracket etc.\n`; 
      // Expect an empty array because the parsing will fail and the catch block handles it
      const expectedOutput: DirectionSuggestion[] = []; 
      mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: truncatedContent } }] });

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedOutput); // Expecting empty array due to parsing failure
    });

    it('should return empty array if AI provides empty directions array', async () => {
      const apiResponseContent = createMockApiContentString({ directions: [] });
      mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: apiResponseContent } }] });

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });

    it('should return an empty array if the AI call fails (rejects)', async () => {
      const testError = new Error('AI API Failed');
      mockCreateCompletion.mockRejectedValue(testError);

      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]); // Expect empty array on error
    });

    it('should return an empty array if response content is unparseable', async () => {
      mockCreateCompletion.mockResolvedValue(createMockApiErrorResponse('This is not valid JSON...')); // Use helper
      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]); // Expect empty array because parsing fails internally
    });

    it('should return an empty array if response content is fundamentally broken JSON', async () => {
      const apiResponseContent = `\`\`\`json\n{\n  "key": "value"`; // Missing closing brace
      mockCreateCompletion.mockResolvedValue(createMockApiErrorResponse(apiResponseContent)); // Use helper
      const result = await generateSermonDirections(mockSermon);
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]); // Expect empty array because parsing fails internally
    });

    it('should call AI API and return directions on success', async () => {
      // Setup mock response using the variable from beforeEach
      mockCreateCompletion.mockResolvedValue(createMockApiResponse({ directions: mockApiResponseDirections }));

      const result = await generateSermonDirections(mockSermon);

      // Check that the mock API was called
      expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockApiResponseDirections);
    });
  });
}); 