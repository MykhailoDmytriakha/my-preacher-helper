import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { assertLegacyWritable, runLegacyTransaction, updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
import { Group, GroupFlowItem } from '@/models/models';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems, removeSeriesItemByRef } from '@/utils/seriesItems';

const GROUPS_COLLECTION = 'groups';
const ERROR_GROUP_NOT_FOUND = 'Group not found';

export class GroupsRepository {
  private filterUndefinedValues<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as T;
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

    const cleanUpdates = deepCleanUndefined(
      this.filterUndefinedValues({
        ...updates,
        ...(updates.flow ? { flow: this.normalizeFlow(updates.flow) } : {}),
        updatedAt: new Date().toISOString(),
      })
    );

    await updateLegacyDocument(adminDb.collection(GROUPS_COLLECTION).doc(groupId), cleanUpdates);
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

    await updateLegacyDocument(adminDb.collection(GROUPS_COLLECTION).doc(groupId), updateData);
  }

  async deleteGroup(groupId: string, ownerUid?: string): Promise<void> {
    const reference = adminDb.collection(GROUPS_COLLECTION).doc(groupId);
    await runLegacyTransaction(async transaction => {
      const group = await transaction.get(reference);
      if (!group.exists) return;
      const owner = group.data()?.userId;
      if (!owner || (ownerUid !== undefined && owner !== ownerUid)) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied', status: 403 });
      assertLegacyWritable(group.data());
      const series = await transaction.get(adminDb.collection('series').where('userId', '==', owner).limit(101));
      if (series.docs.length > 99) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: 'data-engine-required' });
      for (const document of series.docs) {
        const data = document.data();
        if (data.userId !== owner) continue;
        const items = normalizeSeriesItems(data.items, data.sermonIds || []);
        if (!items.some(item => item.type === 'group' && item.refId === groupId)) continue;
        const nextItems = removeSeriesItemByRef(items, { type: 'group', refId: groupId });
        transaction.update(document.ref, { items: nextItems, sermonIds: deriveSermonIdsFromItems(nextItems),
          seriesKind: inferSeriesKind(nextItems), 'rev.items': FieldValue.increment(1), updatedAt: new Date().toISOString() });
      }
      transaction.delete(reference);
    });
  }
}

export const groupsRepository = new GroupsRepository();
