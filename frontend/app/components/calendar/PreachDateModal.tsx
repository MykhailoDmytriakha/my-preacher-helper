"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { PreachDate, Church } from "@/models/models";

import ChurchAutocomplete from "./ChurchAutocomplete";

interface PreachDateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: Omit<PreachDate, 'id' | 'createdAt'>) => Promise<void>;
    initialData?: PreachDate;
}

export default function PreachDateModal({
    isOpen,
    onClose,
    onSave,
    initialData
}: PreachDateModalProps) {
    const { t } = useTranslation();
    const [date, setDate] = useState(initialData?.date || new Date().toISOString().split('T')[0]);
    const [church, setChurch] = useState<Church>(initialData?.church || { id: "", name: "", city: "" });
    const [audience, setAudience] = useState(initialData?.audience || "");
    const [notes, setNotes] = useState(initialData?.notes || "");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (initialData) {
            setDate(initialData.date);
            setChurch(initialData.church);
            setAudience(initialData.audience || "");
            setNotes(initialData.notes || "");
        } else {
            setDate(new Date().toISOString().split('T')[0]);
            setChurch({ id: "", name: "", city: "" });
            setAudience("");
            setNotes("");
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!church.name) return;

        setIsSaving(true);
        try {
            await onSave({
                date,
                church,
                audience: audience.trim() || undefined,
                notes: notes.trim() || undefined,
            });
            onClose();
        } catch (error) {
            console.error("Error saving preach date:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
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
                        <input
                            id="preach-date-input"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                            required
                        />
                    </div>

                    <ChurchAutocomplete
                        initialValue={church}
                        onChange={setChurch}
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
                            onChange={(e) => setAudience(e.target.value)}
                            placeholder="e.g. Youth, General Service, Wedding"
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
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="Any specific feedback or things to improve..."
                            className="w-full px-3 py-2 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow resize-none"
                        />
                    </div>

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
}
