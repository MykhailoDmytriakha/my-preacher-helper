import type { Church, PreachDate, Sermon } from '@/models/models';
import type { WriteSubmission } from '@/utils/recoverableWrite';

export type DashboardSyncStatus = 'pending' | 'error';

export type DashboardSyncOperation = 'create' | 'update' | 'delete' | 'preach-status';

export interface DashboardSermonSyncState {
  status: DashboardSyncStatus;
  operation: DashboardSyncOperation;
  /** Identifies the exact mutation attempt that produced this state. */
  submissionId?: number;
  message?: string;
  /** Exact submitted human text, rendered verbatim beside a terminal failure. */
  recoveryText?: string;
  /**
   * The write was REFUSED because the record changed on another device — not a
   * failure to repeat. The badge says so in those words, and its two buttons become a
   * real choice: send mine anyway, or keep what the other device stored.
   */
  conflict?: boolean;
  /** Rules or validation refused the write; retrying the same payload cannot help. */
  refused?: boolean;
}

export interface DashboardCreateSermonInput {
  title: string;
  verse: string;
  seriesId?: string;
  plannedDate?: string;
  /**
   * The congregation this sermon is being prepared for. Lands on `Sermon.church`, and —
   * when a planned date is also given — on that date's `church` too, because both facts
   * are true at once and neither is derived from the other (see `Sermon.church`).
   */
  church?: Church;
  unspecifiedChurchName?: string;
}

export interface DashboardEditSermonInput {
  sermon: Sermon;
  title: string;
  verse: string;
  plannedDate: string;
  initialPlannedDate: string;
  /**
   * Edited "prepared for" congregation. `undefined` means this edit did not touch it;
   * a church with a blank name means it was cleared — the update path strips undefined
   * keys, so a deletion cannot travel as `undefined`, and `isUnspecifiedChurch` is the
   * single reader that decides what "not stated" looks like.
   */
  church?: Church;
  unspecifiedChurchName?: string;
}

export type PreachDateDraft = Omit<PreachDate, 'id' | 'createdAt'>;

export interface DashboardOptimisticActions {
  createSermon: (input: DashboardCreateSermonInput) => WriteSubmission & { sermonId: string };
  saveEditedSermon: (
    input: DashboardEditSermonInput
  ) => WriteSubmission;
  deleteSermon: (sermon: Sermon) => WriteSubmission;
  markAsPreachedFromPreferred: (sermon: Sermon, preferredDate: PreachDate) => WriteSubmission;
  unmarkAsPreached: (sermon: Sermon) => WriteSubmission;
  savePreachDate: (
    sermon: Sermon,
    data: PreachDateDraft,
    preachDateToMark: PreachDate | null
  ) => WriteSubmission;
  retrySync: (sermonId: string) => Promise<void>;
  dismissSyncError: (sermonId: string) => void;
}
