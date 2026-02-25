'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function StructurePreviewToggle() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const { settings, loading, updateStructurePreviewAccess } = useUserSettings(user?.uid);

    useEffect(() => {
        let isActive = true;

        if (!user?.uid) {
            if (isActive) {
                setEnabled(false);
                setHasLoaded(true);
            }
            return () => {
                isActive = false;
            };
        }

        if (loading) {
            return () => {
                isActive = false;
            };
        }

        const enabledValue = settings?.enableStructurePreview || false;
        if (isActive) {
            setEnabled(enabledValue);
            setHasLoaded(true);
        }

        return () => {
            isActive = false;
        };
    }, [user?.uid, settings, loading]);

    const handleToggle = async () => {
        if (!user?.uid) return;

        try {
            const newValue = !enabled;
            await updateStructurePreviewAccess(newValue);
            setEnabled(newValue);
        } catch (error) {
            console.error('❌ StructurePreviewToggle: Error updating setting:', error);
            alert('Failed to update setting');
        }
    };

    if (loading && !hasLoaded) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
                <div className="animate-pulse" data-testid="structure-preview-loading">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        {t('settings.structurePreview.title')}
                        <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded-full">
                            Beta
                        </span>
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {t('settings.structurePreview.description')}
                    </p>
                </div>
                <button
                    onClick={handleToggle}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                        }`}
                    role="switch"
                    aria-checked={enabled}
                    data-testid="structure-preview-toggle"
                >
                    <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                    />
                </button>
            </div>
        </div>
    );
}
