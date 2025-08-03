import { Sermon, Plan } from '@/models/models';

// Mock the OpenAI library
jest.mock('openai', () => {
  const mockCreateCompletion = jest.fn();
  
  const mockConstructor = jest.fn().mockImplementation(() => {
    return {
      chat: {
        completions: {
          create: mockCreateCompletion
        }
      }
    };
  });

  (mockConstructor as any).mockCreateCompletion = mockCreateCompletion;
  return mockConstructor;
});

// Mock console methods to avoid noise in tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('generatePlanForSection', () => {
  let mockSermon: Sermon;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();

    // Mock sermon data
    mockSermon = {
      id: 'test-sermon-123',
      title: 'Test Sermon',
      userId: 'user-123',
      verse: 'John 3:16',
      thoughts: [
        { id: '1', text: 'Thought 1', tags: [], date: '2023-01-01' },
        { id: '2', text: 'Thought 2', tags: [], date: '2023-01-01' }
      ],
      date: '2023-01-01'
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Plan Structure Validation', () => {
    it('should handle undefined values in plan structure', async () => {
      // Mock the actual function to test the validation logic
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      // Mock the OpenAI response with undefined values
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: undefined,
              main: null,
              conclusion: ''
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(true);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle non-string values in plan structure', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 123,
              main: true,
              conclusion: {}
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(false);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle valid string values correctly', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 'Introduction content',
              main: 'Main content',
              conclusion: 'Conclusion content'
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(true);
      expect(result.plan.introduction.outline).toBe('Introduction content');
      expect(result.plan.main.outline).toBe('Main content');
      expect(result.plan.conclusion.outline).toBe('Conclusion content');
    });

    it('should handle empty string values correctly', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: '',
              main: '',
              conclusion: ''
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(true);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle missing properties in AI response', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 'Only introduction provided'
              // Missing main and conclusion
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(true);
      expect(result.plan.introduction.outline).toBe('Only introduction provided');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle malformed JSON in AI response', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: 'This is not valid JSON'
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(false);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle AI API errors', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockRejectedValue(new Error('AI API failed'));

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(false);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });
  });

  describe('Section-Specific Generation', () => {
    it('should generate plan for introduction section', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 'Introduction content',
              main: 'Main content',
              conclusion: 'Conclusion content'
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(true);
      expect(result.plan.introduction.outline).toBe('Introduction content');
    });

    it('should generate plan for main section', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 'Introduction content',
              main: 'Main content',
              conclusion: 'Conclusion content'
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'main');

      expect(result.success).toBe(true);
      expect(result.plan.main.outline).toBe('Main content');
    });

    it('should generate plan for conclusion section', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              introduction: 'Introduction content',
              main: 'Main content',
              conclusion: 'Conclusion content'
            })
          }
        }]
      });

      const result = await generatePlanForSection(mockSermon, 'conclusion');

      expect(result.success).toBe(true);
      expect(result.plan.conclusion.outline).toBe('Conclusion content');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockRejectedValue(new Error('Network error'));

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(false);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });

    it('should handle timeout errors', async () => {
      const { generatePlanForSection } = require('@/api/clients/openAI.client');
      
      const mockOpenAI = require('openai');
      const mockCreateCompletion = (mockOpenAI as any).mockCreateCompletion;
      
      mockCreateCompletion.mockRejectedValue(new Error('Request timeout'));

      const result = await generatePlanForSection(mockSermon, 'introduction');

      expect(result.success).toBe(false);
      expect(result.plan.introduction.outline).toBe('');
      expect(result.plan.main.outline).toBe('');
      expect(result.plan.conclusion.outline).toBe('');
    });
  });
}); 

