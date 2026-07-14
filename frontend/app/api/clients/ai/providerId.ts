/** Canonical identifiers for OpenAI-compatible structured-output providers. */
export const providerIds = ['openai', 'gemini', 'openrouter'] as const;

export type ProviderId = (typeof providerIds)[number];
