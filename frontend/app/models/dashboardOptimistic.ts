import type { PreachDate, Sermon } from '@/models/models';

export type DashboardSyncStatus = 'pending' | 'error';

export type DashboardSyncOperation = 'create' | 'update' | 'delete' | 'preach-status';

export interface DashboardSermonSyncState {
  status: DashboardSyncStatus;
  operation: DashboardSyncOperation;
  message?: string;
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
  // Resolves to the client-generated id of the new sermon (or undefined if no
  // authenticated user), so callers can navigate to its route immediately.
  createSermon: (input: DashboardCreateSermonInput) => Promise<string | undefined>;
  saveEditedSermon: (input: DashboardEditSermonInput) => Promise<void>;
  deleteSermon: (sermon: Sermon) => Promise<void>;
  markAsPreachedFromPreferred: (sermon: Sermon, preferredDate: PreachDate) => Promise<void>;
  unmarkAsPreached: (sermon: Sermon) => Promise<void>;
  savePreachDate: (
    sermon: Sermon,
    data: PreachDateDraft,
    preachDateToMark: PreachDate | null
  ) => Promise<void>;
  retrySync: (sermonId: string) => Promise<void>;
  dismissSyncError: (sermonId: string) => void;
}
