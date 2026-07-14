import 'openai/shims/node';

import OpenAI from 'openai';

import type { ProviderId } from './providerId';

/** Disposition consumed by the Phase 3 structured-output fallback runner. */
export type ErrorDisposition = 'terminal' | 'retrySameProvider' | 'tryNextTarget';

export interface ProviderAdapter {
  readonly client: OpenAI;
  classifyError(error: unknown): ErrorDisposition;
}

type ErrorRecord = Record<string, unknown>;

function isErrorRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function collectErrorText(error: unknown): string {
  if (!isErrorRecord(error)) {
    return String(error ?? '').toLowerCase();
  }

  const { name, message, code, type, status, errno, cause } = error;
  return [name, message, code, type, status, errno, collectErrorText(cause)]
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
}

function getStatus(error: unknown): number | null {
  if (!isErrorRecord(error)) {
    return null;
  }

  const status = error.status;
  if (typeof status === 'number') {
    return status;
  }

  if (typeof status === 'string' && /^\d{3}$/.test(status)) {
    return Number(status);
  }

  return getStatus(error.cause);
}

function hasServerStatus(status: number | null, text: string): boolean {
  // Rely on the numeric status field + explicit provider codes, NOT bare digits in
  // free text: Zod/validation messages routinely contain numbers (char limits, token
  // counts), and a bare /5\d{2}/ would misclassify a terminal 400 as retryable.
  return (
    (status !== null && status >= 500 && status <= 599) ||
    text.includes('server_error') ||
    text.includes('internal_server_error')
  );
}

function isNetworkOrTimeout(text: string): boolean {
  return [
    'econnreset',
    'econnrefused',
    'enotfound',
    'etimedout', // Node socket timeout — NOT matched by 'timeout' (no space) or 'timed out'
    'eai_again',
    'epipe',
    'socket hang up',
    'fetch failed',
    'connection error',
    'network',
    'timeout',
    'timed out',
  ].some((signal) => text.includes(signal));
}

function classifyError(error: unknown): ErrorDisposition {
  const text = collectErrorText(error);
  const status = getStatus(error);

  if (
    text.includes('insufficient_quota') ||
    status === 401 ||
    status === 403 ||
    text.includes('invalid_api_key') ||
    text.includes('unauthorized') ||
    text.includes('authentication')
  ) {
    return 'tryNextTarget';
  }

  if (status === 429 || text.includes('rate_limit_exceeded') || text.includes('rate limit') || text.includes('too many requests')) {
    return 'retrySameProvider';
  }

  if (hasServerStatus(status, text) || isNetworkOrTimeout(text)) {
    return 'retrySameProvider';
  }

  return 'terminal';
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

const geminiClient = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  dangerouslyAllowBrowser: true,
});

const openRouterClient = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  dangerouslyAllowBrowser: true,
});

export const providerAdapters: Readonly<Record<ProviderId, ProviderAdapter>> = {
  openai: { client: openaiClient, classifyError },
  gemini: { client: geminiClient, classifyError },
  openrouter: { client: openRouterClient, classifyError },
};
