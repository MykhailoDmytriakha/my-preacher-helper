import { providerAdapters } from '../providerAdapters';
import { resolveStructuredTargets } from '../routing';

describe('resolveStructuredTargets', () => {
  const originalEnvironment = {
    AI_MODEL_TO_USE: process.env.AI_MODEL_TO_USE,
    OPENAI_GPT_MODEL: process.env.OPENAI_GPT_MODEL,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    OPENAI_OPTIMIZATION_MODEL: process.env.OPENAI_OPTIMIZATION_MODEL,
  };

  beforeEach(() => {
    process.env.OPENAI_GPT_MODEL = 'openai-default-model';
    process.env.GEMINI_MODEL = 'gemini-default-model';
    process.env.OPENAI_OPTIMIZATION_MODEL = 'openai-optimization-model';
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it.each([
    [undefined, { providerId: 'openai', modelId: 'openai-default-model' }],
    ['OPENAI', { providerId: 'openai', modelId: 'openai-default-model' }],
    ['GEMINI', { providerId: 'gemini', modelId: 'gemini-default-model' }],
    ['FOO', { providerId: 'openai', modelId: 'openai-default-model' }], // garbage → openai (matches current `!== 'GEMINI'`)
  ])('matches current default-workload mapping when AI_MODEL_TO_USE is %s', (provider, expected) => {
    if (provider === undefined) {
      delete process.env.AI_MODEL_TO_USE;
    } else {
      process.env.AI_MODEL_TO_USE = provider;
    }

    expect(resolveStructuredTargets({ workload: 'structured.default' })).toEqual([expected]);
  });

  it.each([
    [undefined, { providerId: 'openai', modelId: 'openai-optimization-model' }],
    ['OPENAI', { providerId: 'openai', modelId: 'openai-optimization-model' }],
    ['GEMINI', { providerId: 'gemini', modelId: 'gemini-default-model' }],
  ])('preserves the speech-optimization provider rule when AI_MODEL_TO_USE is %s', (provider, expected) => {
    if (provider === undefined) {
      delete process.env.AI_MODEL_TO_USE;
    } else {
      process.env.AI_MODEL_TO_USE = provider;
    }

    expect(resolveStructuredTargets({ workload: 'structured.speechOptimization' })).toEqual([expected]);
  });
});

describe('ProviderAdapter.classifyError', () => {
  const classifyError = providerAdapters.openai.classifyError;

  it.each([
    [{ status: 429, code: 'insufficient_quota' }, 'tryNextTarget'],
    [{ status: 401, code: 'invalid_api_key' }, 'tryNextTarget'],
    [{ status: 403 }, 'tryNextTarget'],
    [{ code: 'invalid_api_key' }, 'tryNextTarget'],
    [{ message: 'Unauthorized' }, 'tryNextTarget'],
    [{ type: 'authentication_error' }, 'tryNextTarget'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'retrySameProvider'],
    [{ status: 503, code: 'server_error' }, 'retrySameProvider'],
    [{ message: 'boom', cause: { status: 503 } }, 'retrySameProvider'],
    [{ status: 400, code: 'invalid_request_error' }, 'terminal'],
    // network/timeout transients (the module's raison d'être — must be retryable)
    [{ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }, 'retrySameProvider'],
    [{ message: 'socket hang up' }, 'retrySameProvider'],
    [{ message: 'boom', cause: { code: 'ECONNRESET' } }, 'retrySameProvider'],
    // terminal 4xx whose message merely CONTAINS numbers must NOT be read as 5xx/429
    [{ status: 400, message: 'string must be at most 512 characters' }, 'terminal'],
    [{ status: 400, message: 'value must be between 100 and 500' }, 'terminal'],
  ] as const)('classifies %j as %s', (error, disposition) => {
    expect(classifyError(error)).toBe(disposition);
  });

  it('lowercases and classifies a raw (non-object) string error', () => {
    expect(classifyError('ECONNRESET happened')).toBe('retrySameProvider');
  });

  it('registers OpenRouter with the same error dispositions as OpenAI', () => {
    expect(providerAdapters.openrouter.classifyError).toBe(providerAdapters.openai.classifyError);
    expect(providerAdapters.openrouter.classifyError({ status: 429 })).toBe('retrySameProvider');
  });
});
