"use client";

import { useTranslation } from "react-i18next";
import { Sermon } from "@/models/models";
import { ExclamationTriangleIcon, PlusIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { formatDate } from "@/utils/dateFormatter";

interface LegacyDataWarningProps {
    pendingSermons: Sermon[];
    onAddDate?: (sermon: Sermon) => void;
}

export default function LegacyDataWarning({ pendingSermons, onAddDate }: LegacyDataWarningProps) {
    const { t } = useTranslation();

    if (pendingSermons.length === 0) return null;

    return (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl p-6 mb-8">
            <div className="flex items-start gap-4">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg shrink-0">
                    <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-grow">
                    <h3 className="text-lg font-bold text-amber-900 dark:text-amber-100 mb-1">
                        {t('calendar.missingDateWarningTitle', { defaultValue: 'Legacy Preaching Data' })}
                    </h3>
                    <p className="text-sm text-amber-800 dark:text-amber-300 mb-4">
                        {t('calendar.missingDateWarningDesc', { defaultValue: 'Some of your older sermons are marked as "preached", but do not have specific dates and churches assigned in the new calendar system.' })}
                    </p>

                    <div className="grid gap-2 max-h-60 overflow-y-auto pr-2">
                        {pendingSermons.map(sermon => (
                            <div key={sermon.id} className="grid items-center gap-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded-xl border border-amber-200/50 dark:border-amber-900/20 shadow-sm">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                        {sermon.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {t('calendar.createdDate', { defaultValue: 'Created: {date}', date: formatDate(sermon.date) })}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {sermon.verse}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Link
                                        href={`/sermons/${sermon.id}`}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors shrink-0"
                                    >
                                        {t('calendar.goToSermon', { defaultValue: 'Go to Sermon' })}
                                    </Link>
                                    <button
                                        onClick={() => onAddDate?.(sermon)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-bold rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors shrink-0"
                                    >
                                        <PlusIcon className="w-3.5 h-3.5" />
                                        {t('calendar.addDateNow')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
