'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';

import type { DocumentData } from '@/data-engine/types';
import type { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

const flow = (data: DocumentData | null) => (data?.flow ?? []) as unknown as GroupFlowItem[];

/** Meeting setup is a manual stage: Start submits the duration edits against their opening values. */
export function useGroupConductForm(groupId: string) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'groups', id: groupId }, 'conduct-setup', [['flow']]);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({
      id: scopeId, title: String(record.baseline.value?.title ?? groupId),
      preview: ((record.stage[0]?.value ?? []) as unknown as GroupFlowItem[]).map(item => {
        const template = ((record.baseline.value?.templates ?? []) as unknown as GroupBlockTemplate[]).find(entry => entry.id === item.templateId);
        return `${item.instanceTitle || template?.title || groupId}: ${item.durationMin ?? '—'} ${t('groupFlow.minutesShort')}`;
      }).join('\n').slice(0, 500),
    })), recover: form.recover });
  const updateDuration = (id: string, durationMin: number | null) => form.update(current => {
    if (!flow(current).some(item => item.id === id)) throw new Error('The meeting block no longer exists');
    return { ...current, flow: flow(current).map(item => item.id === id ? { ...item, durationMin } : item) } as unknown as DocumentData;
  });
  return { form, flow: flow(form.data), updateDuration, recovery };
}
