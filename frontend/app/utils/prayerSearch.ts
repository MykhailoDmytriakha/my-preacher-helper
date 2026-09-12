import { PrayerRequest } from '@/models/models';

import { extractSearchSnippets } from './searchUtils';
import { tokenizeQuery } from './sermonSearch';

export type PrayerSearchTargetType = 'title' | 'description' | 'update' | 'answer' | 'tags';

export interface PrayerSearchTarget {
  type: PrayerSearchTargetType;
  updateId?: string;
}

export interface PrayerSearchOptions {
  searchInUpdates: boolean;
  searchInTags: boolean;
  searchInAnswerText: boolean;
}

function includesWithAllTokens(text: string | undefined, tokens: string[]): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

function anyTextMatches(texts: string[], tokens: string[]): boolean {
  return texts.some((text) => includesWithAllTokens(text, tokens));
}

export function matchesPrayerQuery(
  prayer: PrayerRequest,
  query: string,
  options: PrayerSearchOptions
): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;

  const titleOrDescriptionMatches = anyTextMatches(
    [prayer.title, prayer.description ?? ''],
    tokens
  );

  let tagsMatch = false;
  if (options.searchInTags) {
    tagsMatch = anyTextMatches(prayer.tags ?? [], tokens);
  }

  let updatesMatch = false;
  if (options.searchInUpdates) {
    updatesMatch = anyTextMatches(prayer.updates.map((update) => update.text), tokens);
  }

  const answerTextMatch = options.searchInAnswerText
    ? includesWithAllTokens(prayer.answerText, tokens)
    : false;

  return (
    titleOrDescriptionMatches ||
    tagsMatch ||
    updatesMatch ||
    answerTextMatch
  );
}

export function getPrayerUpdateSearchSnippet(
  prayer: PrayerRequest,
  query: string,
  contextChars: number = 90
): string | null {
  if (!query.trim()) {
    return null;
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return null;
  }

  const updates = [...(prayer.updates ?? [])].reverse();

  for (const update of updates) {
    if (!includesWithAllTokens(update.text, tokens)) {
      continue;
    }

    let matchedText = extractSearchSnippets(update.text, query, contextChars)[0];

    if (!matchedText) {
      const fallback = update.text.trim();
      if (!fallback) {
        continue;
      }

      const maxLength = contextChars * 2;
      matchedText =
        fallback.length > maxLength ? `${fallback.slice(0, maxLength)}...` : fallback;
    }

    return matchedText
      .replace(/(?<=\p{L})(?:\r?\n|\r)(?=\p{L})/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return null;
}

export function getPrayerSearchTarget(
  prayer: PrayerRequest,
  query: string
): PrayerSearchTarget | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return null;
  }

  if (includesWithAllTokens(prayer.title, tokens)) {
    return { type: 'title' };
  }

  if (includesWithAllTokens(prayer.description, tokens)) {
    return { type: 'description' };
  }

  const matchedUpdate = [...(prayer.updates ?? [])]
    .reverse()
    .find((update) => includesWithAllTokens(update.text, tokens));
  if (matchedUpdate) {
    return { type: 'update', updateId: matchedUpdate.id };
  }

  if (includesWithAllTokens(prayer.answerText, tokens)) {
    return { type: 'answer' };
  }

  if (anyTextMatches(prayer.tags ?? [], tokens)) {
    return { type: 'tags' };
  }

  return null;
}
