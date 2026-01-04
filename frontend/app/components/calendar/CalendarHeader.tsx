"use client";

import { CalendarDaysIcon, ChartBarIcon, ListBulletIcon, HomeIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

interface CalendarHeaderProps {
    view: 'month' | 'agenda' | 'analytics';
    onViewChange: (view: 'month' | 'agenda' | 'analytics') => void;
    currentMonth?: Date;
    onGoToToday?: () => void;
}

export default function CalendarHeader({ view, onViewChange, currentMonth, onGoToToday }: CalendarHeaderProps) {
    const { t } = useTranslation();
    const inactiveViewClasses = "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
    const viewButtonBaseClasses = "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors";
    const activeViewClasses = "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm";

    const isCurrentMonth = currentMonth ? (
        currentMonth.getMonth() === new Date().getMonth() &&
        currentMonth.getFullYear() === new Date().getFullYear()
    ) : true;

    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    {t('calendar.title')}
                </h1>

                {view === 'month' && !isCurrentMonth && onGoToToday && (
                    <button
                        onClick={onGoToToday}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                        title={t('calendar.goToToday')}
                    >
                        <HomeIcon className="w-4 h-4" />
                        {t('calendar.today')}
                    </button>
                )}
            </div>

            <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                <button
                    onClick={() => onViewChange('month')}
                    className={`${viewButtonBaseClasses} ${view === 'month'
                        ? activeViewClasses
                        : inactiveViewClasses
                        }`}
                >
                    <CalendarDaysIcon className="w-4 h-4" />
                    {t('calendar.monthView')}
                </button>
                <button
                    onClick={() => onViewChange('agenda')}
                    className={`${viewButtonBaseClasses} ${view === 'agenda'
                        ? activeViewClasses
                        : inactiveViewClasses
                        }`}
                >
                    <ListBulletIcon className="w-4 h-4" />
                    {t('calendar.agendaView')}
                </button>
                <button
                    onClick={() => onViewChange('analytics')}
                    className={`${viewButtonBaseClasses} ${view === 'analytics'
                        ? activeViewClasses
                        : inactiveViewClasses
                        }`}
                >
                    <ChartBarIcon className="w-4 h-4" />
                    {t('calendar.analytics.title')}
                </button>
            </div>
        </div>
    );
}
