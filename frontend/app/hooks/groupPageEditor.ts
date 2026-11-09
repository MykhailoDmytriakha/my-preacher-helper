import type { RecordReadNotice } from '@/components/common/recordReadSummary';
import type { GroupMeetingField } from '@/data-engine/groupMeetingFieldAction';
import type { RecordPresence } from '@/data-engine/recordPresence';
import type { Group, GroupBlockStatus, GroupBlockTemplate, GroupFlowItem } from '@/models/models';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** What the group page draws and edits; every change is persisted by the data engine (useGroupPageEditor). */
export interface GroupPageEditor {
  group: Group | null;
  /** A read-only projection of a held meeting stage, never an editor baseline. */
  retainedGroup?: Group;
  loading: boolean;
  readOnly?: boolean;
  presence?: RecordPresence;
  readNotice?: RecordReadNotice;
  refresh?: () => unknown | Promise<unknown>;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  titleHistory?: { owner: string; generation: string; groupId: string; disabled: boolean; restore: (title: string) => Promise<void> };
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  status: Group['status'];
  setStatus: Dispatch<SetStateAction<Group['status']>>;
  statusHistory?: NonNullable<GroupPageEditor['titleHistory']> & { field: 'status' };
  templates: Group['templates'];
  setTemplates: Dispatch<SetStateAction<Group['templates']>>;
  flowTitleScope?: { owner: string; generation: string; groupId: string; disabled: boolean };
  setBlockStatus: (block: Pick<GroupBlockTemplate, 'id' | 'createdAt'>, status: GroupBlockStatus) => Promise<void>;
  renameBlock: (block: Pick<GroupBlockTemplate, 'id' | 'createdAt'>, title: string) => Promise<void>;
  setStepDuration: (step: Pick<GroupFlowItem, 'id' | 'templateId'>, durationMin: number | null) => Promise<void>;
  renameStep: (step: Pick<GroupFlowItem, 'id' | 'templateId'>, title: string | null) => Promise<void>;
  flow: Group['flow'];
  setFlow: Dispatch<SetStateAction<Group['flow']>>;
  meetingDate: string;
  setMeetingDate: Dispatch<SetStateAction<string>>;
  meetingLocation: string;
  setMeetingLocation: Dispatch<SetStateAction<string>>;
  meetingAudience: string;
  setMeetingAudience: Dispatch<SetStateAction<string>>;
  meetingFieldsEnabled: boolean;
  meetingHistory?: { owner: string; generation: string; rowId: string; date: string; disabled: boolean;
    restore: (rowId: string, date: string) => Promise<void> };
  meetingFieldHistory?: { owner: string; generation: string; rowId: string; rowCreatedAt: string; disabled: boolean;
    current: Record<GroupMeetingField, string | null>;
    restore: (rowId: string, rowCreatedAt: string, field: GroupMeetingField, value: string | null) => Promise<void> };
  deleteGroupDetail: () => void | Promise<void>;
  feedback: ReactNode;
}
