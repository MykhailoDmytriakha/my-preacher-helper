import { generatePlanForSection } from '@/api/clients/openAI.client';
import { Sermon } from '@/models/models';

jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

const getStructuredOutputMock = () => jest.requireMock('@clients/structuredOutput') as {
  callWithStructuredOutput: jest.Mock;
};

describe('generatePlanForSection', () => {
  let mockSermon: Sermon;

  beforeEach(() => {
    jest.clearAllMocks();
    getStructuredOutputMock().callWithStructuredOutput.mockReset();

    mockSermon = {
      id: 'test-sermon-123',
      title: 'Test Sermon',
      userId: 'user-123',
      verse: 'John 3:16',
      thoughts: [
        { id: '1', text: 'Thought 1', tags: [], date: '2023-01-01' },
        { id: '2', text: 'Thought 2', tags: [], date: '2023-01-01' },
      ],
      date: '2023-01-01',
    };
  });

  it('returns generated plan on success', async () => {
    getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: {
        introduction: 'Introduction content',
        main: 'Main content',
        conclusion: 'Conclusion content',
      },
      refusal: null,
      error: null,
    });

    const result = await generatePlanForSection(mockSermon, 'introduction');

    expect(result.success).toBe(true);
    expect(result.plan.introduction.outline).toBe('Introduction content');
    expect(result.plan.main.outline).toBe('Main content');
    expect(result.plan.conclusion.outline).toBe('Conclusion content');
  });

  it('returns empty plan when structured output fails', async () => {
    getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('AI API failed'),
    });

    const result = await generatePlanForSection(mockSermon, 'main');

    expect(result.success).toBe(false);
    expect(result.plan.introduction.outline).toBe('');
    expect(result.plan.main.outline).toBe('');
    expect(result.plan.conclusion.outline).toBe('');
  });

  it('returns empty plan when structured output refuses', async () => {
    getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
      success: false,
      data: null,
      refusal: 'refused',
      error: null,
    });

    const result = await generatePlanForSection(mockSermon, 'conclusion');

    expect(result.success).toBe(false);
    expect(result.plan.introduction.outline).toBe('');
    expect(result.plan.main.outline).toBe('');
    expect(result.plan.conclusion.outline).toBe('');
  });

  it('keeps cyrillic content when returned by model', async () => {
    const cyrillicSermon = { ...mockSermon, title: 'Проповедь', verse: 'Иоанна 3:16' };
    getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: {
        introduction: 'Вступление',
        main: 'Основная часть',
        conclusion: 'Заключение',
      },
      refusal: null,
      error: null,
    });

    const result = await generatePlanForSection(cyrillicSermon, 'main');

    expect(result.success).toBe(true);
    expect(result.plan.main.outline).toBe('Основная часть');
  });
});
