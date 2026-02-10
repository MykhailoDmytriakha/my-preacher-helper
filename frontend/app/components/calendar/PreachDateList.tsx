"use client";

import {
    CalendarDaysIcon,
    MapPinIcon,
    PencilSquareIcon,
    TrashIcon,
    PlusIcon,
    FaceSmileIcon
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { usePreachDates } from "@/hooks/usePreachDates";
import { PreachDate } from "@/models/models";
import { parseDateOnlyAsLocalDate } from "@/utils/dateOnly";
import { getEffectivePreachDateStatus } from "@/utils/preachDateStatus";

import PreachDateModal from "./PreachDateModal";


interface PreachDateListProps {
    sermonId: string;
}

export default function PreachDateList({ sermonId }: PreachDateListProps) {
    const { t, i18n } = useTranslation();
    const { preachDates, isLoading, addDate, updateDate, deleteDate } = usePreachDates(sermonId);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDate, setEditingDate] = useState<PreachDate | undefined>(undefined);

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    const handleAddClick = () => {
        setEditingDate(undefined);
        setIsModalOpen(true);
    };

    const handleEditClick = (pd: PreachDate) => {
        setEditingDate(pd);
        setIsModalOpen(true);
    };

    const handleDeleteClick = async (dateId: string) => {
        if (window.confirm(t('calendar.deleteConfirm'))) {
            await deleteDate(dateId);
        }
    };

    const handleSave = async (data: Omit<PreachDate, 'id' | 'createdAt'>) => {
        if (editingDate) {
            await updateDate({ dateId: editingDate.id, updates: data });
        } else {
            await addDate(data);
        }
    };

    if (isLoading) {
        return (
            <div className="animate-pulse space-y-3">
                {[1, 2].map(i => (
                    <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <CalendarDaysIcon className="w-4 h-4" />
                    {t('calendar.title')}
                </h3>
                <button
                    onClick={handleAddClick}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                    <PlusIcon className="w-3.5 h-3.5" />
                    {t('calendar.addPreachDate')}
                </button>
            </div>

            {preachDates.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    {t('calendar.noPreachDates')}
                </p>
            ) : (
                <div className="space-y-2">
                    {preachDates.sort((a, b) => b.date.localeCompare(a.date)).map((pd) => {
                        const status = getEffectivePreachDateStatus(pd, false);
                        const isPreached = status === 'preached';
                        const statusClasses = isPreached
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';

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
                                            return format(parsedDate, 'PP', { locale: getDateLocale() });
                                        })()}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusClasses}`}>
                                        {isPreached
                                            ? t('calendar.status.preached', { defaultValue: 'Preached' })
                                            : t('calendar.status.planned', { defaultValue: 'Planned' })}
                                    </span>
                                    {pd.outcome && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${pd.outcome === 'excellent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' :
                                                pd.outcome === 'good' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' :
                                                    pd.outcome === 'average' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
                                                        'bg-red-100 text-red-700 dark:bg-red-900/30'
                                            }`}>
                                            {t(`calendar.outcomes.${pd.outcome}`)}
                                        </span>
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
                                    onClick={() => handleEditClick(pd)}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    title={t('common.edit')}
                                >
                                    <PencilSquareIcon className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDeleteClick(pd.id)}
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

            <PreachDateModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                initialData={editingDate}
                defaultStatus="planned"
            />
        </div>
    );
}
