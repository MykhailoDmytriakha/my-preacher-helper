import { z } from 'zod';

const parseMock = jest.fn();
const emitStructuredTelemetryEvent = jest.fn();
const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
};
const formatDuration = jest.fn(() => '10ms');
const buildSimplePromptBlueprint = jest.fn();
const zodResponseFormat = jest.fn(() => ({ mocked: true }));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    beta: {
      chat: {
        completions: {
          parse: parseMock,
        },
      },
    },
  })),
}));

jest.mock('openai/helpers/zod', () => ({
  zodResponseFormat,
}));

jest.mock('@/api/clients/aiTelemetry', () => ({
  emitStructuredTelemetryEvent,
}));

jest.mock('@/api/clients/openAIHelpers', () => ({
  logger,
  formatDuration,
}));

jest.mock('@/api/clients/promptBuilder', () => ({
  buildSimplePromptBlueprint,
}));

describe('structuredOutput client', () => {
  const schema = z.object({
    answer: z.string(),
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.OPENAI_GPT_MODEL = 'gpt-test';
    process.env.GEMINI_MODEL = 'gemini-test';
    process.env.AI_MODEL_TO_USE = 'OPENAI';
    process.env.DEBUG_MODE = 'false';

    buildSimplePromptBlueprint.mockReturnValue({
      promptName: 'test',
      promptVersion: 'v1',
      expectedLanguage: null,
      context: { source: 'test' },
      systemPrompt: 'SYS',
      userMessage: 'USR',
    });
  });

  afterEach(() => {
    delete process.env.OPENAI_GPT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.AI_MODEL_TO_USE;
    delete process.env.DEBUG_MODE;
  });

  it('returns parsed payload on success and emits telemetry', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { answer: 'ok' }, content: 'raw' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      logContext: { source: 'test' },
    });

    expect(result).toEqual({
      success: true,
      data: { answer: 'ok' },
      refusal: null,
      error: null,
    });
    expect(parseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'SYS\n\nUSR' }],
      })
    );
    expect(zodResponseFormat).toHaveBeenCalledWith(schema, 'test-format');
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        parsedOutput: { answer: 'ok' },
      })
    );
  });

  it('returns refusal when model declines response', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { refusal: 'policy', content: 'nope' } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
    });

    expect(result.success).toBe(false);
    expect(result.refusal).toBe('policy');
    expect(result.error).toBeNull();
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'refusal',
        refusal: 'policy',
      })
    );
  });

  it('returns error result when parsed payload is missing', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'raw' } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('No parsed data in response');
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'invalid_response',
      })
    );
  });

  it('returns normalized error when parse throws', async () => {
    parseMock.mockRejectedValueOnce('broken');

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      model: 'model-override',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('broken');
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        model: 'model-override',
      })
    );
  });

  it('exposes current model/provider helpers', async () => {
    const mod = await import('@/api/clients/structuredOutput');
    expect(mod.getCurrentAIModel()).toBe('gpt-test');
    expect(mod.getCurrentAIProvider()).toBe('OPENAI');

    process.env.AI_MODEL_TO_USE = 'GEMINI';
    expect(mod.getCurrentAIProvider()).toBe('GEMINI');
  });
});
