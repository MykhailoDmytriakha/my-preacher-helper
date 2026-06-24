import { adminDb } from '@/config/firebaseAdminConfig';
import { Group, GroupFlowItem, GroupMeetingDate } from '@/models/models';

const GROUPS_COLLECTION = 'groups';
const ERROR_GROUP_NOT_FOUND = 'Group not found';

export class GroupsRepository {
  private filterUndefinedValues<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as T;
  }

  private deepCleanUndefined<T>(value: T): T {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.deepCleanUndefined(item)) as T;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, this.deepCleanUndefined(v)])
      ) as T;
    }
    return value;
  }

  private normalizeFlow(flow: GroupFlowItem[] = []): GroupFlowItem[] {
    return [...flow]
      .filter((item) => Boolean(item?.id) && Boolean(item.templateId))
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));
  }

  private hydrateGroup(group: Group): Group {
    return {
      ...group,
      templates: group.templates || [],
      flow: this.normalizeFlow(group.flow || []),
      meetingDates: group.meetingDates || [],
      status: group.status || 'draft',
    };
  }

  async fetchGroupById(groupId: string): Promise<Group | null> {
    const docSnap = await adminDb.collection(GROUPS_COLLECTION).doc(groupId).get();
    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data() as Omit<Group, 'id'>;
    return this.hydrateGroup({ ...data, id: docSnap.id } as Group);
  }

  async updateGroup(groupId: string, updates: Partial<Group>): Promise<Group> {
    const current = await this.fetchGroupById(groupId);
    if (!current) {
      throw new Error(ERROR_GROUP_NOT_FOUND);
    }

    const cleanUpdates = this.deepCleanUndefined(
      this.filterUndefinedValues({
        ...updates,
        ...(updates.flow ? { flow: this.normalizeFlow(updates.flow) } : {}),
        updatedAt: new Date().toISOString(),
      })
    );

    await adminDb.collection(GROUPS_COLLECTION).doc(groupId).update(cleanUpdates);
    return this.hydrateGroup({
      ...current,
      ...cleanUpdates,
    } as Group);
  }

  async updateGroupSeriesInfo(groupId: string, seriesId: string | null, position: number | null): Promise<void> {
    const updateData: { seriesId?: string | null; seriesPosition?: number | null } = {};

    if (seriesId !== undefined) {
      updateData.seriesId = seriesId;
    }

    if (position !== undefined) {
      updateData.seriesPosition = position;
    }

    if (Object.keys(updateData).length === 0) {
      return;
    }

    await adminDb.collection(GROUPS_COLLECTION).doc(groupId).update(updateData);
  }

  async deleteGroup(groupId: string): Promise<void> {
    await adminDb.collection(GROUPS_COLLECTION).doc(groupId).delete();
  }

  async addMeetingDate(
    groupId: string,
    payload: Omit<GroupMeetingDate, 'id' | 'createdAt'>
  ): Promise<GroupMeetingDate> {
    const group = await this.fetchGroupById(groupId);
    if (!group) {
      throw new Error(ERROR_GROUP_NOT_FOUND);
    }

    const nextMeetingDate: GroupMeetingDate = {
      ...payload,
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    };

    await this.updateGroup(groupId, {
      meetingDates: [...(group.meetingDates || []), nextMeetingDate],
    });

    return nextMeetingDate;
  }

  async updateMeetingDate(
    groupId: string,
    dateId: string,
    updates: Partial<GroupMeetingDate>
  ): Promise<GroupMeetingDate> {
    const group = await this.fetchGroupById(groupId);
    if (!group) {
      throw new Error(ERROR_GROUP_NOT_FOUND);
    }

    const nextMeetingDates = [...(group.meetingDates || [])];
    const index = nextMeetingDates.findIndex((entry) => entry.id === dateId);

    if (index === -1) {
      throw new Error('Meeting date not found');
    }

    const nextDate: GroupMeetingDate = {
      ...nextMeetingDates[index],
      ...updates,
      id: nextMeetingDates[index].id,
      createdAt: nextMeetingDates[index].createdAt,
    };

    nextMeetingDates[index] = nextDate;
    await this.updateGroup(groupId, { meetingDates: nextMeetingDates });

    return nextDate;
  }

  async deleteMeetingDate(groupId: string, dateId: string): Promise<void> {
    const group = await this.fetchGroupById(groupId);
    if (!group) {
      throw new Error(ERROR_GROUP_NOT_FOUND);
    }

    await this.updateGroup(groupId, {
      meetingDates: (group.meetingDates || []).filter((entry) => entry.id !== dateId),
    });
  }
}

export const groupsRepository = new GroupsRepository();
