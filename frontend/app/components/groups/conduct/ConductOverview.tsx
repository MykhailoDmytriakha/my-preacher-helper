'use client';

import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTime } from '@/hooks/useConductTimer';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

interface ConductOverviewProps {
  flow: GroupFlowItem[];
  templates: GroupBlockTemplate[];
  // currentIndex === flow.length means all blocks completed
  currentIndex: number;
  // Actual elapsed seconds per block (flowItem.id → seconds)
  blockTimes: Record<string, number>;
  onSelect: (index: number) => void;
  onEnd: () => void;
}

export default function ConductOverview({
  flow,
  templates,
  currentIndex,
  blockTimes,
  onSelect,
  onEnd,
}: ConductOverviewProps) {
  const { t } = useTranslation();

  const templatesById = useMemo(
    () => new Map(templates.map((tpl) => [tpl.id, tpl])),
    [templates]
  );

  const allCompleted = currentIndex >= flow.length;

  const totalElapsed = useMemo(() => {
    if (!allCompleted) return null;
    return Object.values(blockTimes).reduce((sum, s) => sum + s, 0);
  }, [allCompleted, blockTimes]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-5 dark:border-gray-700">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t('conduct.overview.title', { defaultValue: 'Meeting Flow' })}
        </h1>

        {allCompleted && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800/50 dark:bg-emerald-950/30">
            <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t('conduct.overview.completed', { defaultValue: 'All blocks completed' })}
            </span>
          </div>
        )}
      </div>

      {/* Flow list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          {flow.map((item, index) => {
            const template = templatesById.get(item.templateId);
            const title = item.instanceTitle || template?.title || `Block ${index + 1}`;
            const isVisited = allCompleted || index < currentIndex;
            const isCurrent = !allCompleted && index === currentIndex;
            const recordedTime = blockTimes[item.id]; // seconds or undefined

            return (
              <button
                key={item.id}
                onClick={() => onSelect(index)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all hover:shadow-sm active:scale-[0.99] ${
                  isCurrent
                    ? 'border-blue-300 bg-blue-50 shadow-sm dark:border-blue-700 dark:bg-blue-950/40'
                    : isVisited
                      ? 'border-gray-200 bg-gray-50 dark:border-gray-700/50 dark:bg-gray-800/50'
                      : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                }`}
              >
                {/* Indicator */}
                {isVisited && !isCurrent ? (
                  <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isCurrent
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {isCurrent ? '→' : index + 1}
                  </span>
                )}

                {/* Title */}
                <span
                  className={`flex-1 text-sm font-medium ${
                    isCurrent
                      ? 'text-blue-900 dark:text-blue-100'
                      : isVisited
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {title}
                </span>

                {/* Actual elapsed time (if recorded) */}
                {recordedTime !== undefined ? (
                  <span className="font-mono text-xs font-semibold text-gray-500 tabular-nums dark:text-gray-400">
                    {formatTime(recordedTime)}
                  </span>
                ) : item.durationMin && item.durationMin > 0 && !isVisited ? (
                  // Future block with planned duration
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {item.durationMin} {t('groupFlow.minutesShort', { defaultValue: 'min' })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Total time row */}
        {allCompleted && totalElapsed !== null && totalElapsed > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t('conduct.overview.totalTime', { defaultValue: 'Total' })}
            </span>
            <span className="font-mono text-sm font-bold text-gray-900 tabular-nums dark:text-gray-100">
              {formatTime(totalElapsed)}
            </span>
          </div>
        )}
      </div>

      {/* End button */}
      <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-700">
        <button
          onClick={onEnd}
          className={`w-full rounded-xl px-6 py-3 text-base font-semibold shadow-sm transition active:scale-[0.98] ${
            allCompleted
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('conduct.overview.end', { defaultValue: 'End Meeting' })}
        </button>
      </div>
    </div>
  );
}
