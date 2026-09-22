"use client";
import { MapPinIcon, PencilSquareIcon, TrashIcon, FaceSmileIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

import { Chip } from "@/components/ui/Chip";
import { useAppLocale } from "@/hooks/useAppLocale";
import { parseDateOnlyAsLocalDate } from "@/utils/dateOnly";
import { getEffectivePreachDateStatus } from "@/utils/preachDateStatus";

import type { PreachDate } from "@/models/models";
import type { ChipTone } from "@/utils/chipClasses";
const OUTCOME_TONES: Record<string, ChipTone> = { excellent: 'emerald', good: 'blue', average: 'amber', poor: 'rose' };
export function PreachDateRows({ preachDates, isPreached: sermonIsPreached = false, disabled = false, onEdit, onDelete }: {
    preachDates: PreachDate[]; isPreached?: boolean; disabled?: boolean;
    onEdit: (date: PreachDate) => void; onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    const { dateLocale } = useAppLocale();
    return <>
            {preachDates.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    {t('calendar.noPreachDates')}
                </p>
            ) : (
                <div className="space-y-2">
                    {[...preachDates].sort((a, b) => b.date.localeCompare(a.date)).map((pd) => {
                        const status = getEffectivePreachDateStatus(pd, sermonIsPreached);
                        const isPreached = status === 'preached';
                        const statusTone: ChipTone = isPreached ? 'emerald' : 'amber';

                        return (
                        <div
                            key={pd.id}
                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50"
                        >
                            <div className="flex flex-col min-w-0 pr-4">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                        {(() => {
                                            const parsedDate = parseDateOnlyAsLocalDate(pd.date);
                                            if (!parsedDate) {
                                                return pd.date;
                                            }
                                            return format(parsedDate, 'PP', { locale: dateLocale });
                                        })()}
                                    </span>
                                    <Chip weight="bold" tone={statusTone} size="xs" className="uppercase tracking-wider">
                                        {isPreached
                                            ? t('calendar.status.preached', { defaultValue: 'Preached' })
                                            : t('calendar.status.planned', { defaultValue: 'Planned' })}
                                    </Chip>
                                    {pd.outcome && (
                                        <Chip weight="bold" tone={OUTCOME_TONES[pd.outcome] ?? 'rose'} size="xs" className="uppercase">
                                            {t(`calendar.outcomes.${pd.outcome}`)}
                                        </Chip>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                    <div className="flex items-center gap-1 group">
                                        <MapPinIcon className="w-3.5 h-3.5 text-blue-500" />
                                        <span className="truncate max-w-[150px]">{pd.church.name}</span>
                                    </div>
                                    {pd.audience && (
                                        <div className="flex items-center gap-1">
                                            <FaceSmileIcon className="w-3.5 h-3.5" />
                                            <span className="truncate max-w-[100px]">{pd.audience}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    disabled={disabled}
                                    onClick={() => onEdit(pd)}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    title={t('common.edit')}
                                >
                                    <PencilSquareIcon className="w-4 h-4" />
                                </button>
                                <button
                                    disabled={disabled}
                                    onClick={() => onDelete(pd.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                    title={t('common.delete')}
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}

    </>;
}
