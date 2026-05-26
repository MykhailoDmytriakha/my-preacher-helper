/**
 * Audio Export Modal
 *
 * Thin frame around the Audio Studio working surface. Styling follows the site
 * design system: clean white / gray-900 surface, thin orange accent stripe
 * (orange is the audio feature's color among the TXT/PDF/Word export siblings).
 */

'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { Volume2 } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import StepByStepWizard from './audio/StepByStepWizard';

interface AudioExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    sermonId: string;
    sermonTitle: string;
    isEnabled?: boolean;
}

export default function AudioExportModal({
    isOpen,
    onClose,
    sermonId,
    sermonTitle,
    isEnabled = true,
}: AudioExportModalProps) {
    const { t } = useTranslation();
    const [isGenerating, setIsGenerating] = useState(false);

    const handleClose = useCallback(() => {
        if (isGenerating) return;
        onClose();
    }, [isGenerating, onClose]);

    const handleGeneratingChange = useCallback((generating: boolean) => {
        setIsGenerating(generating);
    }, []);

    // Lock background scroll while open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
            onClick={handleClose}
            data-testid="modal-overlay"
        >
            <div
                className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Accent stripe — orange = audio */}
                <div className="h-1 w-full flex-shrink-0 bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600" />

                {/* Header */}
                <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
                            <Volume2 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                            <span className="mb-0.5 inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-100 dark:bg-orange-900/30 dark:text-orange-200 dark:ring-orange-800/60">
                                Beta
                            </span>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                {t('audioExport.title', { defaultValue: 'Audio Generation' })}
                            </h2>
                        </div>
                    </div>

                    <button
                        onClick={handleClose}
                        disabled={isGenerating}
                        className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    >
                        <XMarkIcon className="h-6 w-6" />
                    </button>
                </div>

                {/* Working surface */}
                <div className="min-h-0 flex-1 overflow-hidden p-6">
                    <StepByStepWizard
                        sermonId={sermonId}
                        sermonTitle={sermonTitle}
                        onClose={handleClose}
                        onGeneratingChange={handleGeneratingChange}
                        isEnabled={isEnabled}
                    />
                </div>
            </div>
        </div>
    );
}
