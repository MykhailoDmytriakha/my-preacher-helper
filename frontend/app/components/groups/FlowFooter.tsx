'use client';

import { ClockIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

interface FlowFooterProps {
    totalDuration: number;
    filledCount: number;
    totalCount: number;
}

export default function FlowFooter({ totalDuration, filledCount, totalCount }: FlowFooterProps) {
    const { t } = useTranslation();

    if (totalCount === 0) return null;

    const progressPercent = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

    return (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-gray-50 px-4 py-2.5 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            {totalDuration > 0 && (
                <div className="inline-flex items-center gap-1.5">
                    <ClockIcon className="h-3.5 w-3.5" />
                    <span>
                        ~{totalDuration} {t('groupFlow.stats.duration', { defaultValue: 'min' })}
                    </span>
                </div>
            )}
            <div className="inline-flex items-center gap-1.5">
                <CheckCircleIcon className="h-3.5 w-3.5" />
                <span>
                    {filledCount}/{totalCount} {t('groupFlow.stats.filled', { defaultValue: 'filled' })}
                </span>
            </div>
            <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>
        </div>
    );
}
