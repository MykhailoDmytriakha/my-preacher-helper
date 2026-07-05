import { selectExpiredDraftIds } from '@/utils/recordingDraftStore';

/**
 * `fake-indexeddb` is not installed and we deliberately do NOT add it as a
 * dependency, so the full IndexedDB CRUD + prune round-trip is covered by
 * manual/integration testing. Here we exhaustively unit-test the pure expiry
 * decision `selectExpiredDraftIds`, which is the logic that could actually be
 * wrong.
 */
describe('selectExpiredDraftIds', () => {
  const NOW = 1_000_000_000_000; // fixed reference point
  const DAY = 24 * 60 * 60 * 1000;
  const TTL = 7 * DAY;

  it('returns no ids for an empty list', () => {
    expect(selectExpiredDraftIds([], NOW, TTL)).toEqual([]);
  });

  it('selects drafts older than the TTL', () => {
    const drafts = [{ id: 'old', createdAt: NOW - TTL - 1 }];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual(['old']);
  });

  it('keeps fresh drafts (younger than TTL)', () => {
    const drafts = [{ id: 'fresh', createdAt: NOW - 1 }];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual([]);
  });

  it('treats a draft exactly at the cutoff as NOT expired (boundary)', () => {
    // createdAt === now - ttl => not strictly less than cutoff => keep
    const drafts = [{ id: 'edge', createdAt: NOW - TTL }];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual([]);
  });

  it('expires a draft one millisecond past the cutoff (boundary)', () => {
    const drafts = [{ id: 'just-over', createdAt: NOW - TTL - 1 }];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual(['just-over']);
  });

  it('returns only the expired ids from a mixed list, preserving order', () => {
    const drafts = [
      { id: 'a-fresh', createdAt: NOW - DAY },
      { id: 'b-old', createdAt: NOW - 8 * DAY },
      { id: 'c-fresh', createdAt: NOW },
      { id: 'd-old', createdAt: NOW - 30 * DAY },
    ];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual(['b-old', 'd-old']);
  });

  it('respects a custom (shorter) TTL', () => {
    const oneHour = 60 * 60 * 1000;
    const drafts = [
      { id: 'recent', createdAt: NOW - 30 * 60 * 1000 }, // 30 min old
      { id: 'stale', createdAt: NOW - 2 * oneHour }, // 2 h old
    ];
    expect(selectExpiredDraftIds(drafts, NOW, oneHour)).toEqual(['stale']);
  });

  it('with a zero TTL, any draft created before now is expired', () => {
    const drafts = [
      { id: 'past', createdAt: NOW - 1 },
      { id: 'present', createdAt: NOW },
    ];
    expect(selectExpiredDraftIds(drafts, NOW, 0)).toEqual(['past']);
  });

  it('does not treat future-dated drafts as expired', () => {
    const drafts = [{ id: 'future', createdAt: NOW + DAY }];
    expect(selectExpiredDraftIds(drafts, NOW, TTL)).toEqual([]);
  });
});
