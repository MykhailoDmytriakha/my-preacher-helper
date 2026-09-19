'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConductBlock from '@/components/groups/conduct/ConductBlock';
import ConductOverview from '@/components/groups/conduct/ConductOverview';
import ConductPreflight from '@/components/groups/conduct/ConductPreflight';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, isCollectionOnEngine } from '@/data-engine/react.client';
import { useConductTimer } from '@/hooks/useConductTimer';
import { useGroupConductForm } from '@/hooks/useGroupConductForm';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { GroupFlowItem } from '@/models/models';
import { normalizeFlow } from '@/utils/groupFlow';

import type { Group } from '@/models/models';
import type { ReactNode } from 'react';

type Phase = 'preflight' | 'conducting' | 'overview';

export default function ConductPage() {
  const { id } = useParams();
  const groupId = typeof id === 'string' ? id : '';
  return isCollectionOnEngine('groups')
    ? <DataDocumentProvider key={groupId} resource={{ collection: 'groups', id: groupId }} options={{ slot: 'group-conduct', autoSave: false }}><EngineConductPage groupId={groupId} /></DataDocumentProvider>
    : <LegacyConductPage groupId={groupId} />;
}
function LegacyConductPage({ groupId }: { groupId: string }) {
  const { group, loading, updateGroupDetail } = useGroupDetail(groupId);
  return <ConductView groupId={groupId} group={group} loading={loading} saveFlow={flow => updateGroupDetail({ flow })} />;
}
function EngineConductPage({ groupId }: { groupId: string }) {
  const document = useGroupDataDocument(groupId);
  const { form, flow, updateDuration, recovery } = useGroupConductForm(groupId);
  const feedback = <div className="shrink-0 px-5 py-2">
    <DataSyncStatus status={document.status} error={document.error} onRetry={document.refresh}
      onAcceptRemote={document.acceptRemote} onKeepLocal={document.keepLocal} />
    {form.active && <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
      recoveryChoices={recovery.choices} onListRecovery={recovery.refresh} onRecover={recovery.recover}
      recoveryLoading={recovery.loading} recoveryError={recovery.error} />}
  </div>;
  return <ConductView groupId={groupId} group={document.group ? { ...document.group, flow } : null}
    loading={document.loading || form.loading} saveFlow={() => form.save()}
    updateDuration={(id, duration) => { void updateDuration(id, duration).catch(() => undefined); }}
    setupDisabled={form.loading || !form.active || form.busy || form.status?.phase === 'deleted'} feedback={feedback} />;
}
function ConductView({ groupId, group, loading, saveFlow, updateDuration, setupDisabled = false, feedback }: {
  groupId: string; group: Group | null; loading: boolean; saveFlow: (flow: GroupFlowItem[]) => Promise<void>;
  updateDuration?: (id: string, durationMin: number | null) => void; setupDisabled?: boolean; feedback?: ReactNode;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('preflight');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [localFlow, setLocalFlow] = useState<GroupFlowItem[] | null>(null);
  const [totalMeetingMin, setTotalMeetingMin] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Accumulated elapsed seconds per block (flowItem.id → seconds).
  // Persists across overview peeks — restored as initialElapsed when returning to a block.
  const [blockTimes, setBlockTimes] = useState<Record<string, number>>({});

  // Global timer lives here so it persists across block changes
  const { timeLeft: globalTimeLeft, isOvertime: globalIsOvertime } = useConductTimer(
    totalMeetingMin,
    isPaused
  );

  const activeFlow = useMemo(() => {
    if (localFlow) return localFlow;
    if (group?.flow) return normalizeFlow(group.flow);
    return [];
  }, [localFlow, group]);

  const templates = group?.templates ?? [];

  // Called by ConductBlock before any navigation — saves elapsed for this block
  const handleTimeRecorded = useCallback((flowItemId: string, elapsed: number) => {
    setBlockTimes((prev) => ({ ...prev, [flowItemId]: elapsed }));
  }, []);

  const handleStart = async (updatedFlow: GroupFlowItem[], meetingMin: number | null) => {
    try { await saveFlow(updatedFlow); } catch { return; }
    setLocalFlow(updatedFlow);
    setTotalMeetingMin(meetingMin);
    setIsPaused(false);
    setBlockTimes({});
    setCurrentIndex(0);
    setPhase('conducting');
  };

  const handleNext = () => {
    setCurrentIndex((i) => i + 1);
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  // "≡" hamburger — mid-meeting peek: pause timer, keep currentIndex (block still in-progress)
  const handlePeek = useCallback(() => {
    setIsPaused(true);
    setPhase('overview');
  }, []);

  // "Overview →" on last block — block is done, all blocks completed
  const handleCompleteAll = useCallback(() => {
    setCurrentIndex(activeFlow.length); // sentinel: all done
    setPhase('overview');
  }, [activeFlow.length]);

  // Return from overview to a specific block — resume timer
  const handleSelectFromOverview = (index: number) => {
    setCurrentIndex(index);
    setIsPaused(false); // resume (was paused during peek)
    setPhase('conducting');
  };

  const handleEnd = () => router.push(`/groups/${groupId}`);
  const handleBack = () => router.push(`/groups/${groupId}`);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white dark:bg-gray-950">
        {feedback}
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {t('workspaces.groups.errors.loadFailed', { defaultValue: 'Failed to load group' })}
        </div>
      </div>
    );
  }

  if (activeFlow.length === 0) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-white dark:bg-gray-950">
        {feedback}
        <p className="text-gray-600 dark:text-gray-400">
          {t('groupFlow.emptyState', { defaultValue: 'No blocks yet' })}
        </p>
        <button
          onClick={handleBack}
          className="rounded-xl border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← {t('conduct.preflight.backToGroup', { defaultValue: 'Back to group' })}
        </button>
      </div>
    );
  }

  const currentFlowItem = activeFlow[currentIndex];
  const currentTemplate = templates.find((tpl) => tpl.id === currentFlowItem?.templateId);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-white dark:bg-gray-950">
      {feedback}
      {phase === 'preflight' && (
        <ConductPreflight
          flow={activeFlow}
          templates={templates}
          onStart={handleStart}
          onUpdateDuration={updateDuration}
          disabled={setupDisabled}
          onBack={handleBack}
        />
      )}

      {phase === 'conducting' && currentFlowItem && currentTemplate && (
        <ConductBlock
          key={currentFlowItem.id}
          flowItem={currentFlowItem}
          template={currentTemplate}
          index={currentIndex}
          total={activeFlow.length}
          isPaused={isPaused}
          onPause={() => setIsPaused(true)}
          onResume={() => setIsPaused(false)}
          globalTimeLeft={totalMeetingMin !== null ? globalTimeLeft : null}
          globalIsOvertime={globalIsOvertime}
          initialElapsed={blockTimes[currentFlowItem.id] ?? 0}
          onTimeRecorded={handleTimeRecorded}
          onPrev={handlePrev}
          onNext={handleNext}
          onPeek={handlePeek}
          onCompleteAll={handleCompleteAll}
        />
      )}

      {phase === 'overview' && (
        <ConductOverview
          flow={activeFlow}
          templates={templates}
          currentIndex={currentIndex}
          blockTimes={blockTimes}
          onSelect={handleSelectFromOverview}
          onEnd={handleEnd}
        />
      )}
    </div>
  );
}
