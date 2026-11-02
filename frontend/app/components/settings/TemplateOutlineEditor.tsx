'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
import { outlinePointGridClass } from '@/utils/structureBoardLayout';
import { useTranslation } from '@locales/useTranslation';

import type { SermonOutline } from '@/models/models';

export interface TemplateOutlineEditorHandle {
  capture: () => Promise<void>;
  remove: () => Promise<void>;
  snapshot: () => string;
}

/** The document owns points and their lifetime; the surrounding list owns only selection. */
const TemplateOutlineEditor = forwardRef<TemplateOutlineEditorHandle, { templateId: string; disabled: boolean }>(
  function TemplateOutlineEditor({ templateId, disabled }, ref) {
    const { t } = useTranslation();
    const document = useDataDocument({ collection: 'planTemplates', id: templateId },
      { slot: 'template-structure', autoSaveDelayMs: 400, readOnlyCopy: true });
    const latest = useRef(document);
    latest.current = document;
    const identity = document.recoveryIdentity;
    useImperativeHandle(ref, () => {
      const current = () => {
        if (latest.current.recoveryIdentity !== identity) throw new Error('The template editor changed');
        return latest.current;
      };
      return {
        // save() captures locally. Delivery and any later refusal remain engine-owned.
        capture: async () => { const document = current(); if (document.state) await document.save(); },
        remove: async () => { await current().remove(); },
        snapshot: () => JSON.stringify([templateId, current().data?.structure]),
      };
    }, [templateId, identity]);
    const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
      enabled: !document.loading && document.status !== null,
      version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
      list: async () => (await document.listRecoverable()).map(source => ({ id: source.id,
        title: String(source.record.checkpoint.draft?.name ?? source.record.checkpoint.confirmed.value?.name ?? t('settings.planTemplates')),
        discard: () => document.discardRecovery(source) })),
      recover: document.recover });
    return <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords}
        onRetry={document.retry} onKeepLocal={async () => { await document.keepLocal(); await document.save(); }}
        onAcceptRemote={document.acceptRemote} recoveryChoices={recovery.choices}
        recoveryLoading={recovery.loading} recoveryError={recovery.error} onRecover={recovery.recover}
        onDiscardRecovery={recovery.discard} />
      {document.loading && !document.data ? <p className="text-sm text-gray-400">{t('settings.loading')}</p>
        : document.data && <OutlineBoard value={document.data.structure as unknown as SermonOutline}
          isReadOnly={disabled || document.readOnly} className={`${outlinePointGridClass} gap-3`}
          onChange={structure => { void document.update(current => current ? { ...current, structure: structure as never } : current).catch(() => undefined); }} />}
    </fieldset>;
  }
);

export default TemplateOutlineEditor;
