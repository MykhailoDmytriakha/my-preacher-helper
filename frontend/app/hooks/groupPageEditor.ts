import type { Group } from '@/models/models';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** Shared presentation contract; persistence belongs to the selected data adapter. */
export interface GroupPageEditor {
  group: Group | null;
  loading: boolean;
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
  debouncedSave: () => void;
  saveStatus: string;
  deleteGroupDetail: () => void | Promise<void>;
  feedback: ReactNode;
}
