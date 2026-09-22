"use client";

import {
    CalendarDaysIcon,
    PlusIcon
} from "@heroicons/react/24/outline";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { isCollectionOnEngine } from "@/data-engine/react.client";
import { useConfirm } from '@/hooks/useConfirm';
import { usePreachDates } from "@/hooks/usePreachDates";
import { PreachDate } from "@/models/models";
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';

import { EnginePreachDateList } from "./EnginePreachDateList";
import PreachDateModal from "./PreachDateModal";
import { PreachDateRows } from "./PreachDateRows";

interface PreachDateListProps {
    sermonId: string;
}

export default function PreachDateList({ sermonId }: PreachDateListProps) {
    return isCollectionOnEngine('sermons') ? <EnginePreachDateList sermonId={sermonId} /> : <LegacyPreachDateList sermonId={sermonId} />;
}

function LegacyPreachDateList({ sermonId }: PreachDateListProps) {
    const { t } = useTranslation();
    const { confirm, confirmDialog } = useConfirm();
    const { preachDates, isLoading, addDate, updateDate, deleteDate } = usePreachDates(sermonId);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDate, setEditingDate] = useState<PreachDate | undefined>(undefined);

    const handleAddClick = () => {
        setEditingDate(undefined);
        setIsModalOpen(true);
    };

    const handleEditClick = (pd: PreachDate) => {
        setEditingDate(pd);
        setIsModalOpen(true);
    };

    const handleDeleteClick = async (dateId: string) => {
        if (await confirm({ title: t('calendar.deleteConfirm'), confirmText: t('common.delete') })) {
            try {
                // usePreachDates' delete recovery descriptor reports a late refusal while this screen is mounted.
                await awaitAcceptance(deleteDate(dateId), () => undefined);
            } catch (error) {
                // Reported by the delete descriptor in `usePreachDates`, which also
                // follows the person off this screen. Announcing here as well showed
                // one refused delete as two failures.
                console.error('Error deleting preach date:', error);
            }
        }
    };

    const handleSave = (data: Omit<PreachDate, 'id' | 'createdAt'>): WriteSubmission => {
        if (editingDate) {
            return updateDate({ dateId: editingDate.id, updates: data });
        }
        return addDate(data);
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

            <PreachDateRows preachDates={preachDates} onEdit={handleEditClick} onDelete={id => { void handleDeleteClick(id); }} />

            <PreachDateModal
                sermonId={sermonId}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                initialData={editingDate}
                defaultStatus="planned"
            />
            {confirmDialog}
        </div>
    );
}
