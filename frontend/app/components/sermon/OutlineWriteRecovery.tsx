'use client';

import { useState } from 'react';

import { OutlineConflictScopeProvider, type OutlineConflictController } from '@/components/plan-editor/OutlineConflictScope';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import { useTranslation } from '@locales/useTranslation';

import type { useDataDocument } from '@/data-engine/react.client';
import type { Sermon } from '@/models/models';
import type { ReactNode } from 'react';

interface OutlineWriteRecoveryProps {
  owner: string | null;
  sermonId: string;
  document: Pick<ReturnType<typeof useDataDocument>, 'data' | 'readOnly'>;
  writer: StructureWriter;
  recovery: OutlineConflictController;
  children: ReactNode;
}

export function OutlineWriteRecovery({ owner, sermonId, document, writer, recovery, children }: OutlineWriteRecoveryProps) {
  const { t } = useTranslation();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const identity = JSON.stringify([owner, sermonId]);
  const isOpen = openedFor === identity;
  const data = document.data as (Sermon & { userId?: string }) | null;
  const canReview = Boolean(owner && !document.readOnly && data && data.userId === owner);
  const pending = (recovery.record?.payload.resolution !== 'local' && recovery.record)
    || recovery.choices.copies.some(copy => copy.value.payload.resolution !== 'local');
  const sermon = data ? { ...data, id: sermonId, thoughts: data.thoughts ?? [] } as Sermon : null;
  const close = () => setOpenedFor(current => current === identity ? null : current);

  return <StructureWriterContext.Provider value={writer}>
    <OutlineConflictScopeProvider owner={owner} sermonId={sermonId} controller={recovery}>
      {canReview && pending && !recovery.editing && !isOpen && <section role="alert" className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('freshness.conflictTitle')}</p>
        <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
          {t('freshness.conflictDescription', { entity: t('freshness.entitySermon') })}
        </p>
        <button type="button" className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
          onClick={() => setOpenedFor(identity)}>{t('freshness.reviewAction')}</button>
      </section>}
      {children}
      {canReview && sermon && isOpen && <PlanEditorModal isOpen onClose={close} sermon={sermon} />}
    </OutlineConflictScopeProvider>
  </StructureWriterContext.Provider>;
}
