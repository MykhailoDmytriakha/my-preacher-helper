import type { PreachDate, Sermon } from '@/models/models';
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
  unspecifiedChurchName?: string;
}

export interface DashboardEditSermonInput {
  sermon: Sermon;
  title: string;
  verse: string;
  plannedDate: string;
  initialPlannedDate: string;
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
