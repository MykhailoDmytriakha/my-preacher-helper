import { Group, GroupMeetingDate } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const isBrowserOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
const OFFLINE_ERROR = 'Offline: operation not available.';

export const getAllGroups = async (userId: string): Promise<Group[]> => {
  if (isBrowserOffline()) {
    throw new Error(OFFLINE_ERROR);
  }

  const response = await fetch(`${API_BASE}/api/groups?userId=${userId}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch groups');
  }

  return response.json();
};

export const getGroupById = async (groupId: string): Promise<Group | undefined> => {
  if (isBrowserOffline()) {
    throw new Error(OFFLINE_ERROR);
  }

  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch group');
  }

  return response.json();
};

export const createGroup = async (group: Omit<Group, 'id'>): Promise<Group> => {
  if (isBrowserOffline()) {
    throw new Error(OFFLINE_ERROR);
  }

  const response = await fetch(`${API_BASE}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(group),
  });

  if (!response.ok) {
    throw new Error('Failed to create group');
  }

  const data = await response.json();
  return data.group;
};

export const updateGroup = async (groupId: string, updates: Partial<Group>): Promise<Group> => {
  if (isBrowserOffline()) {
    throw new Error(OFFLINE_ERROR);
  }

  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error('Failed to update group');
  }

  return response.json();
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  if (isBrowserOffline()) {
    throw new Error(OFFLINE_ERROR);
  }

  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete group');
  }
};

export const addGroupMeetingDate = async (
  groupId: string,
  payload: Omit<GroupMeetingDate, 'id' | 'createdAt'>
): Promise<GroupMeetingDate> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add group meeting date');
  }

  const data = await response.json();
  return data.meetingDate;
};

export const updateGroupMeetingDate = async (
  groupId: string,
  dateId: string,
  updates: Partial<GroupMeetingDate>
): Promise<GroupMeetingDate> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates/${dateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update group meeting date');
  }

  const data = await response.json();
  return data.meetingDate;
};

export const deleteGroupMeetingDate = async (groupId: string, dateId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates/${dateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete group meeting date');
  }
};

export const fetchCalendarGroups = async (
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Group[]> => {
  const params = new URLSearchParams({ userId });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const response = await fetch(`${API_BASE}/api/calendar/groups?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch calendar groups');
  }

  const data = await response.json();
  return data.groups;
};
