"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import DatePickerField from "@/components/ui/DatePickerField";
import { PreachDate, Church, PreachDateStatus } from "@/models/models";
import { getTodayDateOnlyKey, toDateOnlyKey } from "@/utils/dateOnly";
import {
    awaitAcceptance,
    type WriteSubmission,
} from "@/utils/recoverableWrite";

import ChurchAutocomplete from "./ChurchAutocomplete";

import type { DashboardSermonSyncState } from "@/models/dashboardOptimistic";

const SAVE_ERROR_KEY = 'common.saveError';

interface PreachDateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (
        data: Omit<PreachDate, 'id' | 'createdAt'>
    ) => WriteSubmission;
    initialData?: PreachDate;
    defaultStatus?: PreachDateStatus;
    /** Terminal state from the dashboard mutation cache, which owns rollback. */
    syncState?: DashboardSermonSyncState;
}

export default function PreachDateModal({
    isOpen,
    onClose,
    onSave,
    initialData,
    defaultStatus,
    syncState,
}: PreachDateModalProps) {
    const { t } = useTranslation();
    const [date, setDate] = useState(toDateOnlyKey(initialData?.date) || getTodayDateOnlyKey());
    const [church, setChurch] = useState<Church>(initialData?.church || { id: "", name: "", city: "" });
    const [audience, setAudience] = useState(initialData?.audience || "");
    const [notes, setNotes] = useState(initialData?.notes || "");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    useEffect(() => {
        if (initialData) {
            setDate(toDateOnlyKey(initialData.date) || getTodayDateOnlyKey());
            setChurch(initialData.church);
            setAudience(initialData.audience || "");
            setNotes(initialData.notes || "");
        } else {
            setDate(getTodayDateOnlyKey());
            setChurch({ id: "", name: "", city: "" });
            setAudience("");
            setNotes("");
        }
        setSaveError("");
    }, [initialData, isOpen]);

    useEffect(() => {
        /**
         * NO `isSaving` GATE — it is cleared in `finally`, before the failed state
         * arrives, so an early refusal was silent while the covered badge could not
         * speak for it either.
         */
        if (syncState?.status !== 'error') return;

        setSaveError(
            syncState.refused || syncState.conflict
                ? t('writeRecovery.refused')
                : syncState.message || t(SAVE_ERROR_KEY)
        );
        setIsSaving(false);
    }, [syncState, t]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!church.name) return;

        const resolvedStatus = initialData ? initialData.status : defaultStatus;

        setIsSaving(true);
        setSaveError("");
        try {
            const submission = onSave({
                date,
                status: resolvedStatus,
                church,
                audience: audience.trim() || undefined,
                notes: notes.trim() || undefined,
            });

            await awaitAcceptance(submission, (error) => {
                // Reported by usePreachDates' recovery descriptor, which carries the
                // church, audience and notes — one refusal, one reporter.
                console.error('Preach date write refused after acceptance:', error);
            });
            onClose();
        } catch (error) {
            // Same reporter owns an early refusal; this editor stays open with the text.
            console.error('Preach date write refused:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="preach-date-modal-title"
                className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-700"
            >
                <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                    <h2 id="preach-date-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                        {initialData ? t('calendar.editPreachDate') : t('calendar.addPreachDate')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label
                            htmlFor="preach-date-input"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t('calendar.date')}
                        </label>
                        <DatePickerField
                            id="preach-date-input"
                            value={date}
                            onChange={(value) => {
                                setDate(value);
                                setSaveError("");
                            }}
                            inputClassName="w-full px-3 py-2 pr-12 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                            required
                        />
                    </div>

                    <ChurchAutocomplete
                        initialValue={church}
                        onChange={(value) => {
                            setChurch(value);
                            setSaveError("");
                        }}
                    />

                    <div>
                        <label
                            htmlFor="preach-audience-input"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t('calendar.audience')}
                        </label>
                        <input
                            id="preach-audience-input"
                            type="text"
                            value={audience}
                            onChange={(e) => {
                                setAudience(e.target.value);
                                setSaveError("");
                            }}
                            placeholder={t('calendar.audiencePlaceholder')}
                            className="w-full px-3 py-2 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="preach-notes-input"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t('calendar.notes')}
                        </label>
                        <textarea
                            id="preach-notes-input"
                            value={notes}
                            onChange={(e) => {
                                setNotes(e.target.value);
                                setSaveError("");
                            }}
                            rows={3}
                            placeholder={t('calendar.notesPlaceholder')}
                            className="w-full px-3 py-2 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow resize-none"
                        />
                    </div>

                    {saveError && (
                        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                            {saveError}
                        </p>
                    )}

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                            {t('buttons.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving || !church.name}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {isSaving ? t('buttons.saving') : t('buttons.save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    if (mounted) {
        return createPortal(modalContent, document.body);
    }
    return null;
}
