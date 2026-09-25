'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';

import { createGroupDraft, CreateGroupView } from './CreateGroupModal';

import type { DocumentData } from '@/data-engine/types';
import type { Group } from '@/models/models';

/** Typed creation fields are durable immediately; only Create may submit them. */
export function EngineCreateGroupModal({ groupId, recoveryId, onClose, onQueued }: {
  groupId: string; recoveryId?: string; onClose: () => void; onQueued: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [initial] = useState(() => deepCleanUndefined(createGroupDraft(user?.uid ?? '', '', '', '', t)));
  const document = useDataDocument({ collection: 'groups', id: groupId }, { create: true, autoSave: false, slot: 'group-create' });
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(!recoveryId);
  const [failure, setFailure] = useState<string | null>(null);
  const attempted = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!recoveryId || document.loading || attempted.current) return;
    attempted.current = true;
    void document.recover(recoveryId).then(() => { if (mounted.current) setRestored(true); }, error => {
      if (mounted.current) setFailure(error instanceof Error ? error.message : 'Draft recovery failed');
    });
  }, [document, recoveryId]);
  const value = (document.data ?? initial) as unknown as Omit<Group, 'id'>;
  const edit = (updater: (current: Omit<Group, 'id'>) => Omit<Group, 'id'>) => {
    void document.update(current => deepCleanUndefined(updater((current ?? initial) as unknown as Omit<Group, 'id'>)) as unknown as DocumentData).catch(() => undefined);
  };
  const create = async () => {
    if (saving || document.loading || !restored) return;
    setSaving(true); setFailure(null);
    try {
      await document.commit(current => {
        const next = (current ?? initial) as unknown as Omit<Group, 'id'>;
        if (!next.title.trim()) throw new Error(t('workspaces.groups.form.title'));
        return deepCleanUndefined({ ...next, title: next.title.trim(), description: next.description?.trim() || undefined }) as unknown as DocumentData;
      });
      if (mounted.current) onQueued(groupId);
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : 'Group creation failed'); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <CreateGroupView title={value.title} setTitle={title => edit(current => ({ ...current, title }))}
    description={value.description ?? ''} setDescription={description => edit(current => ({ ...current, description }))}
    firstMeetingDate={value.meetingDates?.[0]?.date ?? ''} setFirstMeetingDate={date => {
      const id = newClientId(), createdAt = new Date().toISOString();
      edit(current => ({ ...current, meetingDates: date ? [{ ...(current.meetingDates?.[0] ?? { id, createdAt }), date }] : [] }));
    }} saving={saving || document.loading || !restored} onClose={onClose}
    handleSubmit={event => { event.preventDefault(); void create(); }}
    feedback={<DataSyncStatus status={document.status} error={failure ?? document.error} onRetry={async () => {
      if (recoveryId && !restored) { await document.recover(recoveryId); setRestored(true); setFailure(null); }
      else await document.retry();
    }} />} />;
}
