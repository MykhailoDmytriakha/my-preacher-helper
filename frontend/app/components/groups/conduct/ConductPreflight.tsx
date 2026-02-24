'use client';

import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

interface ConductPreflightProps {
  flow: GroupFlowItem[];
  templates: GroupBlockTemplate[];
  onStart: (updatedFlow: GroupFlowItem[], totalMeetingMin: number | null) => void;
  onBack: () => void;
}

export default function ConductPreflight({ flow, templates, onStart, onBack }: ConductPreflightProps) {
  const { t } = useTranslation();
  const [localFlow, setLocalFlow] = useState<GroupFlowItem[]>(flow);
  const [totalMeetingMin, setTotalMeetingMin] = useState<number | null>(null);

  const templatesById = useMemo(
    () => new Map(templates.map((tpl) => [tpl.id, tpl])),
    [templates]
  );

  const blocksDuration = useMemo(
    () => localFlow.reduce((sum, item) => sum + (item.durationMin || 0), 0),
    [localFlow]
  );

  const minLabel = t('groupFlow.minutesShort', { defaultValue: 'min' });

  const hasDurations = localFlow.some((item) => item.durationMin && item.durationMin > 0);
  const someEmpty = hasDurations && localFlow.some((item) => !item.durationMin || item.durationMin <= 0);

  const updateDuration = (flowItemId: string, value: string) => {
    const num = value === '' ? null : parseInt(value, 10);
    setLocalFlow((prev) =>
      prev.map((item) =>
        item.id === flowItemId ? { ...item, durationMin: num && num > 0 ? num : null } : item
      )
    );
  };

  const handleTotalChange = (value: string) => {
    const num = value === '' ? null : parseInt(value, 10);
    setTotalMeetingMin(num && num > 0 ? num : null);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t('conduct.preflight.backToGroup', { defaultValue: 'Back to group' })}
        </button>
      </div>

      {/* Title */}
      <div className="border-b border-gray-200 px-5 py-5 dark:border-gray-700">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t('conduct.preflight.title', { defaultValue: 'Meeting Setup' })}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('conduct.preflight.subtitle', { defaultValue: 'Review block durations' })}
        </p>

        {/* Global meeting time */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800/50 dark:bg-blue-950/30">
          <span className="text-lg">⏱</span>
          <span className="flex-1 text-sm font-medium text-blue-900 dark:text-blue-200">
            {t('conduct.preflight.totalTime', { defaultValue: 'Total meeting time' })}
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              max="999"
              value={totalMeetingMin ?? ''}
              onChange={(e) => handleTotalChange(e.target.value)}
              placeholder="—"
              className="w-20 rounded-lg border border-blue-300 bg-white px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none dark:border-blue-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <span className="text-sm text-blue-700 dark:text-blue-400">
              {minLabel}
            </span>
          </div>
        </div>

        {/* Totals row */}
        {(blocksDuration > 0 || totalMeetingMin) && (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {blocksDuration > 0 && (
              <span className="text-gray-600 dark:text-gray-400">
                {t('conduct.preflight.blocksTotal', { defaultValue: 'Blocks' })}: <strong>{blocksDuration} {minLabel}</strong>
              </span>
            )}
            {totalMeetingMin && blocksDuration > 0 && (
              <span className={`font-medium ${totalMeetingMin < blocksDuration ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {totalMeetingMin >= blocksDuration
                  ? `+${totalMeetingMin - blocksDuration} ${minLabel} ${t('conduct.preflight.free', { defaultValue: 'free' })}`
                  : `-${blocksDuration - totalMeetingMin} ${minLabel} ${t('conduct.preflight.over', { defaultValue: 'over' })}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Block list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          {localFlow.map((item, index) => {
            const template = templatesById.get(item.templateId);
            const title = item.instanceTitle || template?.title || `Block ${index + 1}`;
            const isEmpty = !item.durationMin || item.durationMin <= 0;
            const highlight = someEmpty && isEmpty;

            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  highlight
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-950/20'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                }`}
              >
                <span className="min-w-[1.5rem] text-sm font-semibold text-gray-500 dark:text-gray-400">
                  {index + 1}.
                </span>
                <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">
                  {title}
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={item.durationMin ?? ''}
                    onChange={(e) => updateDuration(item.id, e.target.value)}
                    placeholder={t('conduct.preflight.noLimit', { defaultValue: '—' })}
                    className={`w-20 rounded-lg border px-2 py-1 text-right text-sm transition-colors focus:outline-none ${
                      highlight
                        ? 'border-amber-300 bg-white focus:border-amber-500 dark:border-amber-600 dark:bg-gray-800'
                        : 'border-gray-300 bg-white focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-700'
                    } dark:text-gray-200`}
                  />
                  <span className="text-sm text-gray-400">
                    {minLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Start button */}
      <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-700">
        <button
          onClick={() => onStart(localFlow, totalMeetingMin)}
          className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
        >
          {t('conduct.preflight.startButton', { defaultValue: 'Start Meeting' })} →
        </button>
      </div>
    </div>
  );
}
