import type { MembershipRef } from './membershipIntent';

export type SeriesHistorySelection = { id: string; generation: string | null; label: string };

export interface SeriesMembershipComparison {
  ref: MembershipRef;
  label: string;
  proposed: SeriesHistorySelection | null;
  stored: SeriesHistorySelection | null;
}

export interface SeriesMembershipHistoryEntry {
  id: string;
  former: SeriesHistorySelection | null;
  current: SeriesHistorySelection | null;
  acceptedAt: string;
}

export interface SeriesMembershipHistoryPage {
  owner: string;
  collection: 'sermons' | 'groups';
  memberId: string;
  generation: string | null;
  entries: SeriesMembershipHistoryEntry[];
  nextCursor: string | null;
}
