import type { Group } from '@/models/models';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** What the group page draws and edits; every change is persisted by the data engine (useGroupPageEditor). */
export interface GroupPageEditor {
  group: Group | null;
  loading: boolean;
  readOnly?: boolean;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  status: Group['status'];
  setStatus: Dispatch<SetStateAction<Group['status']>>;
  templates: Group['templates'];
  setTemplates: Dispatch<SetStateAction<Group['templates']>>;
  flow: Group['flow'];
  setFlow: Dispatch<SetStateAction<Group['flow']>>;
  meetingDate: string;
  setMeetingDate: Dispatch<SetStateAction<string>>;
  meetingLocation: string;
  setMeetingLocation: Dispatch<SetStateAction<string>>;
  meetingAudience: string;
  setMeetingAudience: Dispatch<SetStateAction<string>>;
  meetingFieldsEnabled: boolean;
  deleteGroupDetail: () => void | Promise<void>;
  feedback: ReactNode;
}
