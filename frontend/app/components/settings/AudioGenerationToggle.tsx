/**
 * Audio Generation Settings Toggle
 * 
 * Beta feature toggle for enabling/disabling audio generation.
 * Pattern from PrepModeToggle.tsx
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';

/**
 * Toggle component for enabling/disabling the audio generation beta feature.
 * Displays in the Settings page under User Settings section.
 */
export default function AudioGenerationToggle() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const { settings, loading, updateAudioGenerationAccess } = useUserSettings(user?.uid);

    useEffect(() => {
        let isActive = true;

        if (!user?.uid) {
            if (isActive) {
                setEnabled(false);
                setHasLoaded(true);
            }
            return () => { isActive = false; };
        }

        if (loading) {
            return () => { isActive = false; };
        }

        const enabledValue = settings?.enableAudioGeneration || false;
        if (isActive) {
            setEnabled(enabledValue);
            setHasLoaded(true);
        }

        return () => { isActive = false; };
    }, [user?.uid, settings, loading]);

    const handleToggle = async () => {
        if (!user?.uid) return;

        try {
            const newValue = !enabled;
            await updateAudioGenerationAccess(newValue);
            setEnabled(newValue);
        } catch (error) {
            console.error('AudioGenerationToggle: Error updating setting:', error);
            alert('Failed to update setting');
        }
    };

    if (loading && !hasLoaded) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
                <div className="animate-pulse" data-testid="audio-generation-loading">
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
                        {t('settings.audioGeneration.title', { defaultValue: 'Sermon Audio Generation (Beta)' })}
                        <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded-full">
                            Beta
                        </span>
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {t('settings.audioGeneration.description', {
                            defaultValue: 'Enable experimental audio generation for sermons'
                        })}
                    </p>
                </div>
                <button
                    onClick={handleToggle}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                    role="switch"
                    aria-checked={enabled}
                    data-testid="audio-generation-toggle"
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>
        </div>
    );
}
