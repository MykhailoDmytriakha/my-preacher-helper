"use client";

import { useTranslation } from "react-i18next";
import { CalendarDaysIcon, ChartBarIcon, ListBulletIcon } from "@heroicons/react/24/outline";

interface CalendarHeaderProps {
    view: 'month' | 'agenda' | 'analytics';
    onViewChange: (view: 'month' | 'agenda' | 'analytics') => void;
}

export default function CalendarHeader({ view, onViewChange }: CalendarHeaderProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {t('calendar.title')}
            </h1>

            <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                <button
                    onClick={() => onViewChange('month')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'month'
                        ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        }`}
                >
                    <CalendarDaysIcon className="w-4 h-4" />
                    {t('calendar.monthView')}
                </button>
                <button
                    onClick={() => onViewChange('agenda')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'agenda'
                        ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        }`}
                >
                    <ListBulletIcon className="w-4 h-4" />
                    {t('calendar.agendaView')}
                </button>
                <button
                    onClick={() => onViewChange('analytics')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'analytics'
                        ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        }`}
                >
                    <ChartBarIcon className="w-4 h-4" />
                    {t('calendar.analytics.title')}
                </button>
            </div>
        </div>
    );
}
