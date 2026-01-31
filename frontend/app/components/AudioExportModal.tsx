/**
 * Audio Export Modal
 * 
 * Premium modal component for audio generation using Step-by-Step wizard.
 * Styling aligned with project patterns (CreateSeriesModal, BrainstormModule).
 */

'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { Volume2, Check } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { WizardStep } from '@/types/audioGeneration.types';

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
    const [step, setStep] = useState<WizardStep>('settings');

    const handleClose = useCallback(() => {
        if (isGenerating) return;
        onClose();
    }, [isGenerating, onClose]);

    const handleGeneratingChange = useCallback((generating: boolean) => {
        setIsGenerating(generating);
    }, []);

    // Prevent background scrolling when modal is open and reset step
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setStep('settings');
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    const steps: { id: WizardStep; label: string }[] = [
        { id: 'settings', label: t('audioExport.step1', { defaultValue: 'Settings' }) },
        { id: 'review', label: t('audioExport.step2', { defaultValue: 'Review' }) },
        { id: 'generate', label: t('audioExport.step3', { defaultValue: 'Generate' }) },
    ];

    const currentStepIndex =
        step === 'optimize' ? 0 :
            step === 'preview' ? 1 :
                step === 'success' ? 3 :
                    steps.findIndex(s => s.id === step);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
            onClick={handleClose}
            data-testid="modal-overlay"
        >
            <div
                className="w-full max-w-[95vw] h-[95vh] overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800 flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Gradient Header Stripe */}
                <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-500 flex-shrink-0" />

                {/* Header with Integrated Stepper */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                    {/* Left: Title */}
                    <div className="flex items-center gap-3 w-[200px]">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 dark:from-blue-500/30 dark:to-purple-500/30 flex items-center justify-center">
                            <Volume2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-2.5 py-0.5 text-[10px] font-semibold text-purple-700 ring-1 ring-purple-100 dark:bg-purple-900/30 dark:text-purple-200 dark:ring-purple-800/60 uppercase tracking-wider mb-1">
                                Beta
                            </p>
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                {t('audioExport.title', { defaultValue: 'Audio Generation' })}
                            </h2>
                        </div>
                    </div>

                    {/* Middle: Stepper */}
                    <div className="flex-1 flex justify-center">
                        <div className="relative flex items-center min-w-[300px] max-w-md w-full pb-6">
                            {/* Background Line */}
                            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-gray-100 dark:bg-gray-800 -z-1 rounded-full -translate-y-3" />

                            {/* Active Progress Line */}
                            <div
                                className="absolute top-1/2 left-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 rounded-full -translate-y-3"
                                style={{ width: `${(Math.min(currentStepIndex, steps.length - 1) / (steps.length - 1)) * 100}%` }}
                            />

                            <div className="flex justify-between w-full">
                                {steps.map((s, i) => {
                                    const isCompleted = i < currentStepIndex;
                                    const isActive = i === currentStepIndex;

                                    return (
                                        <div key={s.id} className="relative z-10 flex flex-col items-center group cursor-default">
                                            <div
                                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${isCompleted
                                                    ? 'bg-purple-600 border-purple-600 text-white'
                                                    : isActive
                                                        ? 'bg-white dark:bg-gray-800 border-purple-500 text-purple-600 shadow-md shadow-purple-500/20 scale-110'
                                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-300'
                                                    }`}
                                            >
                                                {isCompleted ? (
                                                    <Check className="w-3.5 h-3.5" />
                                                ) : isActive ? (
                                                    <div className="w-2 h-2 bg-purple-600 rounded-full" />
                                                ) : (
                                                    <span className="text-[10px] font-bold">{i + 1}</span>
                                                )}
                                            </div>
                                            <span
                                                className={`absolute top-10 text-[10px] font-bold whitespace-nowrap transition-colors ${isActive
                                                    ? 'text-purple-700 dark:text-purple-300'
                                                    : isCompleted
                                                        ? 'text-gray-700 dark:text-gray-300'
                                                        : 'text-gray-400'
                                                    }`}
                                            >
                                                {s.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right: Close */}
                    <div className="w-[200px] flex justify-end">
                        <button
                            onClick={handleClose}
                            disabled={isGenerating}
                            className="rounded-xl p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <XMarkIcon className="h-6 w-6" />
                        </button>
                    </div>
                </div>

                {/* Wizard Content */}
                <div className="flex-1 min-h-0 p-6 overflow-hidden">
                    <StepByStepWizard
                        sermonId={sermonId}
                        sermonTitle={sermonTitle}
                        onClose={handleClose}
                        onGeneratingChange={handleGeneratingChange}
                        isEnabled={isEnabled}
                        step={step}
                        onStepChange={setStep}
                    />
                </div>
            </div>
        </div>
    );
}
