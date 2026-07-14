import { z } from 'zod';

const openaiParseMock = jest.fn();
const geminiParseMock = jest.fn();
const openRouterParseMock = jest.fn();
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
const mockGetUserEntitlementServerSide = jest.fn();
const mockAssertAiUsageAvailable = jest.fn();
const mockConsumeAiUsage = jest.fn();
const mockGetAiModelDefaults = jest.fn();

class MockUsageExhaustedError extends Error {
  readonly code = 'USAGE_EXHAUSTED';
}

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((options?: { baseURL?: string }) => ({
    beta: {
      chat: {
        completions: {
          parse: options?.baseURL?.includes('generativelanguage.googleapis.com')
            ? geminiParseMock
            : options?.baseURL?.includes('openrouter.ai')
              ? openRouterParseMock
              : openaiParseMock,
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

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: mockGetUserEntitlementServerSide,
  resolveEffectiveTier: (entitlement?: { paidTier?: string } | null) => entitlement?.paidTier ?? 'free',
}));

jest.mock('@/services/usageLimits.server', () => ({
  assertAiUsageAvailable: mockAssertAiUsageAvailable,
  consumeAiUsage: mockConsumeAiUsage,
  UsageExhaustedError: MockUsageExhaustedError,
}));

jest.mock('@/services/aiModelDefaults.server', () => ({
  getAiModelDefaults: mockGetAiModelDefaults,
}));

describe('structuredOutput client', () => {
  const schema = z.object({
    answer: z.string(),
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    openaiParseMock.mockReset();
    geminiParseMock.mockReset();
    openRouterParseMock.mockReset();
    process.env.OPENAI_GPT_MODEL = 'gpt-test';
    process.env.GEMINI_MODEL = 'gemini-test';
    process.env.OPENAI_OPTIMIZATION_MODEL = 'gpt-optimization-test';
    process.env.AI_MODEL_TO_USE = 'OPENAI';
    process.env.DEBUG_MODE = 'true';

    buildSimplePromptBlueprint.mockReturnValue({
      promptName: 'test',
      promptVersion: 'v1',
      expectedLanguage: null,
      context: { source: 'test' },
      systemPrompt: 'SYS',
      userMessage: 'USR',
    });
    mockGetUserEntitlementServerSide.mockResolvedValue({ paidTier: 'free' });
    mockConsumeAiUsage.mockResolvedValue(undefined);
    mockGetAiModelDefaults.mockResolvedValue({
      transcription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    });
  });

  afterEach(() => {
    delete process.env.OPENAI_GPT_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.OPENAI_OPTIMIZATION_MODEL;
    delete process.env.AI_MODEL_TO_USE;
    delete process.env.DEBUG_MODE;
  });

  it('returns parsed payload on success and emits telemetry', async () => {
    openaiParseMock.mockResolvedValueOnce({
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
    expect(openaiParseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-test',
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'USR' }
        ],
      })
    );
    expect(zodResponseFormat).toHaveBeenCalledWith(schema, 'test-format');
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'OPENAI',
        status: 'success',
        parsedOutput: { answer: 'ok' },
      })
    );
    expect(mockGetUserEntitlementServerSide).not.toHaveBeenCalled();
  });

  it('returns refusal when model declines response', async () => {
    openaiParseMock.mockResolvedValueOnce({
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
    openaiParseMock.mockResolvedValueOnce({
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
    openaiParseMock.mockRejectedValueOnce('broken');

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

  it('resolves the requested workload before executing the structured call', async () => {
    openaiParseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { answer: 'optimized' } } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'speech-optimization',
      workload: 'structured.speechOptimization',
    });

    expect(result.success).toBe(true);
    expect(openaiParseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-optimization-test',
      })
    );
  });

  it('emits the executed Gemini target as the telemetry provider', async () => {
    process.env.AI_MODEL_TO_USE = 'GEMINI';
    geminiParseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { answer: 'gemini' } } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
    });

    expect(geminiParseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-test',
      })
    );
    expect(openaiParseMock).not.toHaveBeenCalled();
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'GEMINI',
        model: 'gemini-test',
      })
    );
  });

  it('keeps a free user on the configured default even with a paid-model preference', async () => {
    mockGetUserEntitlementServerSide.mockResolvedValueOnce({
      paidTier: 'free',
      preferredText: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
    });
    geminiParseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { answer: 'free' } } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'free-user',
      model: 'gpt-5-mini',
    });

    expect(result.success).toBe(true);
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledTimes(1);
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledWith('free-user', {
      includeTextPreference: true,
    });
    expect(geminiParseMock).toHaveBeenCalledTimes(1);
    expect(geminiParseMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite-preview' }));
    expect(mockAssertAiUsageAvailable).toHaveBeenCalledTimes(1);
    expect(mockConsumeAiUsage).toHaveBeenCalledWith('free-user', expect.any(Date));
  });

  it('rejects an at-limit user before the provider call and does not count further', async () => {
    mockGetUserEntitlementServerSide.mockResolvedValueOnce({ paidTier: 'free' });
    mockAssertAiUsageAvailable.mockImplementationOnce(() => {
      throw new MockUsageExhaustedError('AI usage limit exhausted');
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'at-limit-user',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(MockUsageExhaustedError);
    expect(openaiParseMock).not.toHaveBeenCalled();
    expect(geminiParseMock).not.toHaveBeenCalled();
    expect(mockConsumeAiUsage).not.toHaveBeenCalled();
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledTimes(1);
  });

  it('crosses providers after a try-next-target failure', async () => {
    mockGetUserEntitlementServerSide.mockResolvedValueOnce({
      paidTier: 'tier1',
      preferredText: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
    });
    geminiParseMock.mockRejectedValueOnce({ status: 429, code: 'insufficient_quota' });
    openRouterParseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { answer: 'openrouter-fallback' } } }],
      usage: undefined,
    });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'paid-user',
    });

    expect(result.success).toBe(true);
    expect(geminiParseMock).toHaveBeenCalledTimes(1);
    expect(geminiParseMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.1-flash-lite-preview',
    }));
    expect(openRouterParseMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen/qwen3.7-plus' }));
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'OPENROUTER',
      model: 'qwen/qwen3.7-plus',
      status: 'success',
    }));
  });

  it('advances once to the next target after a retryable provider failure', async () => {
    mockGetUserEntitlementServerSide.mockResolvedValueOnce({
      paidTier: 'tier3',
      preferredText: { providerId: 'openrouter', modelId: 'qwen/qwen3.7-plus' },
    });
    openRouterParseMock
      .mockRejectedValueOnce({ status: 429, code: 'rate_limit_exceeded' })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: { answer: 'fallback' } } }],
        usage: undefined,
      });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'paid-user',
    });

    expect(result).toEqual({
      success: true,
      data: { answer: 'fallback' },
      refusal: null,
      error: null,
    });
    expect(openRouterParseMock).toHaveBeenCalledTimes(2);
    expect(openRouterParseMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'qwen/qwen3.7-plus' }));
    expect(openRouterParseMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'deepseek/deepseek-v4-pro' }));
    expect(emitStructuredTelemetryEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'OPENROUTER',
      model: 'deepseek/deepseek-v4-pro',
      status: 'success',
    }));
  });

  it('stops after one attempt on a terminal provider failure', async () => {
    mockGetUserEntitlementServerSide.mockResolvedValueOnce({ paidTier: 'tier3' });
    geminiParseMock.mockRejectedValueOnce({ status: 400, code: 'invalid_request_error' });

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'paid-user',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(geminiParseMock).toHaveBeenCalledTimes(1);
    expect(openRouterParseMock).not.toHaveBeenCalled();
    expect(mockConsumeAiUsage).not.toHaveBeenCalled();
  });

  it('converts an entitlement-read failure at the public result boundary', async () => {
    mockGetUserEntitlementServerSide.mockRejectedValueOnce(new Error('entitlement unavailable'));

    const mod = await import('@/api/clients/structuredOutput');
    const result = await mod.callWithStructuredOutput('System prompt', 'User prompt', schema, {
      formatName: 'test-format',
      userId: 'user-1',
    });

    expect(result).toEqual({
      success: false,
      data: null,
      refusal: null,
      error: new Error('entitlement unavailable'),
    });
    expect(openaiParseMock).not.toHaveBeenCalled();
    expect(geminiParseMock).not.toHaveBeenCalled();
  });

  it('exposes current model/provider helpers', async () => {
    const mod = await import('@/api/clients/structuredOutput');
    expect(mod.getCurrentAIModel()).toBe('gpt-test');
    expect(mod.getCurrentAIProvider()).toBe('OPENAI');

    process.env.AI_MODEL_TO_USE = 'GEMINI';
    expect(mod.getCurrentAIModel()).toBe('gemini-test');
    expect(mod.getCurrentAIProvider()).toBe('GEMINI');
  });
});
