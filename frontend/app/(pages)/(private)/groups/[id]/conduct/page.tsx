'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConductBlock from '@/components/groups/conduct/ConductBlock';
import ConductOverview from '@/components/groups/conduct/ConductOverview';
import ConductPreflight from '@/components/groups/conduct/ConductPreflight';
import { useConductTimer } from '@/hooks/useConductTimer';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { GroupFlowItem } from '@/models/models';
import { normalizeFlow } from '@/utils/groupFlow';

type Phase = 'preflight' | 'conducting' | 'overview';

export default function ConductPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const groupId = typeof id === 'string' ? id : '';

  const { group, loading, updateGroupDetail } = useGroupDetail(groupId);

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
    setLocalFlow(updatedFlow);
    setTotalMeetingMin(meetingMin);
    setIsPaused(false);
    setBlockTimes({});
    await updateGroupDetail({ flow: updatedFlow });
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
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {t('workspaces.groups.errors.loadFailed', { defaultValue: 'Failed to load group' })}
        </div>
      </div>
    );
  }

  if (activeFlow.length === 0) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-white dark:bg-gray-950">
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
      {phase === 'preflight' && (
        <ConductPreflight
          flow={activeFlow}
          templates={templates}
          onStart={handleStart}
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
