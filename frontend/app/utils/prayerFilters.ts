import { PrayerRequest, PrayerStatus } from '@/models/models';

import { extractSearchSnippets } from './searchUtils';
import { tokenizeQuery } from './sermonSearch';

export type PrayerFilterStatus = 'all' | PrayerStatus;
export type PrayerSortKey = 'updatedAt' | 'createdAt' | 'answeredAt';
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

export interface FilterPrayerRequestsOptions extends PrayerSearchOptions {
  filterStatus: PrayerFilterStatus;
  searchQuery: string;
  sortKey: PrayerSortKey;
}

const FILTER_STATUSES: PrayerFilterStatus[] = ['all', 'active', 'answered', 'not_answered'];
const SORT_KEYS: PrayerSortKey[] = ['updatedAt', 'createdAt', 'answeredAt'];

const SORT_OPTIONS_BY_FILTER: Record<PrayerFilterStatus, PrayerSortKey[]> = {
  all: ['updatedAt', 'createdAt', 'answeredAt'],
  active: ['updatedAt', 'createdAt'],
  answered: ['answeredAt', 'updatedAt', 'createdAt'],
  not_answered: ['updatedAt', 'createdAt'],
};

const DEFAULT_SORT_BY_FILTER: Record<PrayerFilterStatus, PrayerSortKey> = {
  all: 'updatedAt',
  active: 'updatedAt',
  answered: 'answeredAt',
  not_answered: 'updatedAt',
};

function includesWithAllTokens(text: string | undefined, tokens: string[]): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

function anyTextMatches(texts: string[], tokens: string[]): boolean {
  return texts.some((text) => includesWithAllTokens(text, tokens));
}

function getTimestamp(value?: string): number {
  const timestamp = Date.parse(value ?? '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function normalizePrayerFilterStatus(value?: string | null): PrayerFilterStatus {
  if (FILTER_STATUSES.includes(value as PrayerFilterStatus)) {
    return value as PrayerFilterStatus;
  }

  return 'active';
}

export function normalizePrayerSortKey(value?: string | null): PrayerSortKey {
  if (SORT_KEYS.includes(value as PrayerSortKey)) {
    return value as PrayerSortKey;
  }

  return 'updatedAt';
}

export function getPrayerSortOptions(filterStatus: PrayerFilterStatus): PrayerSortKey[] {
  return SORT_OPTIONS_BY_FILTER[filterStatus];
}

export function getDefaultPrayerSortKey(filterStatus: PrayerFilterStatus): PrayerSortKey {
  return DEFAULT_SORT_BY_FILTER[filterStatus];
}

export function clampPrayerSortKey(
  filterStatus: PrayerFilterStatus,
  sortKey?: string | null
): PrayerSortKey {
  const normalizedSortKey = normalizePrayerSortKey(sortKey);
  const allowedSorts = getPrayerSortOptions(filterStatus);

  if (allowedSorts.includes(normalizedSortKey)) {
    return normalizedSortKey;
  }

  return getDefaultPrayerSortKey(filterStatus);
}

export function resolvePrayerSortKey(
  filterStatus: PrayerFilterStatus,
  sortKey?: string | null,
  previousFilterStatus?: PrayerFilterStatus | null
): PrayerSortKey {
  const clampedSortKey = clampPrayerSortKey(filterStatus, sortKey);

  if (!previousFilterStatus || previousFilterStatus === filterStatus) {
    return clampedSortKey;
  }

  const normalizedSortKey = normalizePrayerSortKey(sortKey);
  const previousDefaultSortKey = getDefaultPrayerSortKey(previousFilterStatus);

  if (normalizedSortKey === previousDefaultSortKey) {
    return getDefaultPrayerSortKey(filterStatus);
  }

  return clampedSortKey;
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

function sortPrayerRequests(prayers: PrayerRequest[], sortKey: PrayerSortKey): PrayerRequest[] {
  return [...prayers].sort((left, right) => {
    const leftPrimary = getTimestamp(
      sortKey === 'answeredAt' ? left.answeredAt : left[sortKey]
    );
    const rightPrimary = getTimestamp(
      sortKey === 'answeredAt' ? right.answeredAt : right[sortKey]
    );

    if (rightPrimary !== leftPrimary) {
      return rightPrimary - leftPrimary;
    }

    return getTimestamp(right.updatedAt) - getTimestamp(left.updatedAt);
  });
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

export function filterPrayerRequests(
  prayers: PrayerRequest[],
  options: FilterPrayerRequestsOptions
): PrayerRequest[] {
  const { filterStatus, searchQuery, sortKey, ...searchOptions } = options;
  const normalizedSortKey = clampPrayerSortKey(filterStatus, sortKey);

  const filtered = prayers.filter((prayer) => {
    const matchesStatus =
      filterStatus === 'all' ? true : prayer.status === filterStatus;

    if (!matchesStatus) {
      return false;
    }

    return matchesPrayerQuery(prayer, searchQuery, searchOptions);
  });

  return sortPrayerRequests(filtered, normalizedSortKey);
}
