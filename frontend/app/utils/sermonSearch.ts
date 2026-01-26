import { Sermon } from '@/models/models';

import { extractSearchSnippets } from './searchUtils';
import { getTranslationKeyForTag } from './tagUtils';

interface SermonSearchOptions {
  searchInTitleVerse?: boolean;
  searchInThoughts?: boolean;
  searchInTags?: boolean;
}

const DEFAULT_OPTIONS: Required<SermonSearchOptions> = {
  searchInTitleVerse: true,
  searchInThoughts: true,
  searchInTags: true,
};

export type ThoughtSnippet = {
  text?: string;
  tags: string[];
};

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function textMatchesAllTokens(text: string, tokens: string[]): boolean {
  const haystack = text.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Checks if a tag (id or literal) matches search tokens, 
 * including matching against its localized names if it's structural.
 */
function tagMatchesTokens(tag: string, tokens: string[], t?: (key: string) => string): boolean {
  if (textMatchesAllTokens(tag, tokens)) return true;

  // Also check localized names for structural tags
  const translationKey = getTranslationKeyForTag(tag);
  if (translationKey && t) {
    const localizedName = t(translationKey);
    if (textMatchesAllTokens(localizedName, tokens)) return true;
  }

  return false;
}

function anyTextMatchesAllTokens(texts: string[], tokens: string[]): boolean {
  return texts.some((text) => textMatchesAllTokens(text, tokens));
}

export function matchesSermonQuery(
  sermon: Sermon,
  tokens: string[],
  options?: SermonSearchOptions,
  t?: (key: string) => string
): boolean {
  if (tokens.length === 0) return true;

  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };

  const titleVerseMatches =
    opts.searchInTitleVerse &&
    anyTextMatchesAllTokens([sermon.title || '', sermon.verse || ''], tokens);

  const thoughtTexts = sermon.thoughts?.map((t) => t.text || '') || [];
  const thoughtsMatch =
    opts.searchInThoughts && thoughtTexts.length > 0
      ? anyTextMatchesAllTokens(thoughtTexts, tokens)
      : false;

  const thoughtTags =
    sermon.thoughts?.flatMap((th) => th.tags || []).filter(Boolean) || [];
  const tagsMatch =
    opts.searchInTags && thoughtTags.length > 0
      ? thoughtTags.some((tag) => tagMatchesTokens(tag, tokens, t))
      : false;

  return titleVerseMatches || thoughtsMatch || tagsMatch;
}

export function getThoughtSnippets(
  sermon: Sermon,
  query: string,
  maxSnippets: number = Infinity,
  contextChars: number = 90,
  tokensOverride?: string[],
  t?: (key: string) => string
): ThoughtSnippet[] {
  if (!query.trim()) return [];
  const thoughts = sermon.thoughts || [];
  const collected: ThoughtSnippet[] = [];
  const tokens = tokensOverride ?? tokenizeQuery(query);

  for (const thought of thoughts) {
    if (collected.length >= maxSnippets) break;

    const snippets = extractSearchSnippets(thought.text || '', query, contextChars);
    let matchedText = snippets[0];

    const tags = (thought.tags || []).filter(Boolean);
    const matchedTags = tags.filter((tag) => tagMatchesTokens(tag, tokens, t));

    // If match is only in tags, still show a text snippet so the thought is visible
    if (!matchedText && matchedTags.length > 0) {
      const fallback = (thought.text || '').trim();
      if (fallback) {
        const maxLength = contextChars * 2;
        matchedText =
          fallback.length > maxLength ? `${fallback.slice(0, maxLength)}…` : fallback;
      }
    }

    if (matchedText) {
      matchedText = matchedText
        // Remove line breaks that split a word (letter newline letter → join)
        .replace(/(?<=\p{L})(?:\r?\n|\r)(?=\p{L})/gu, '')
        // Collapse remaining whitespace to single spaces
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (matchedText || matchedTags.length > 0) {
      collected.push({ text: matchedText, tags: matchedTags });
    }
  }

  return collected;
}
