/**
 * Chunk Editor Modal
 * 
 * Modal for editing a single audio chunk text.
 */

'use client';

import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import AudioCorrectionConflict from '@/components/audio/AudioCorrectionConflict';
import { useClipboard } from '@/hooks/useClipboard';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { useModalLayer } from '@/hooks/useModalLayer';
import { refusalWords, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';

import type { SpeechCorrectionConflict } from '@/hooks/usePreparedSpeech';

// ============================================================================
// Types
// ============================================================================

interface ChunkEditorModalProps {
    chunk: {
        index: number;
        text: string;
        kind?: 'body' | 'transition';
    };
    onSave: (index: number, newText: string) => Promise<void>;
    onClose: () => void;
    conflict?: SpeechCorrectionConflict;
    onResolve?: (decision: SpeechCorrectionConflict, index: number, text: string) => Promise<void>;
    onUseStored?: (decision: SpeechCorrectionConflict, index: number) => { text: string } | null;
}

// ============================================================================
// Component
// ============================================================================

export default function ChunkEditorModal({
    chunk,
    onSave,
    onClose, conflict, onResolve, onUseStored,
}: ChunkEditorModalProps) {
    const { t } = useTranslation();
    const [text, setText] = useState(chunk.text);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<FailureWords | null>(null);

    const saving = useRef(false);
    const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
    const clipboard = useClipboard();
    const save = useCallback(async (operation: () => Promise<void>) => {
        if (saving.current) return;
        saving.current = true;
        setIsSaving(true);
        setError(null);

        try {
            await operation();
        } catch (err) {
            // Kept as words, said when shown: the wizard's own refusals are keys (`saidError`).
            setError(refusalWords(err, 'common.saveError'));
        } finally {
            saving.current = false;
            setIsSaving(false);
        }
    }, []);
    const handleSave = useCallback(() => save(() => onSave(chunk.index, text)), [chunk.index, text, onSave, save]);
    const requestClose = useCallback(() => {
        if (!saving.current) void askBeforeDiscard(text !== chunk.text, onClose);
    }, [askBeforeDiscard, text, chunk.text, onClose]);
    const takeStored = (index: number) => {
        const stored = conflict?.source?.chunks[index];
        if (!conflict || !stored || !onUseStored || saving.current) return;
        void askBeforeDiscard(text !== stored.text, () => {
            const accepted = onUseStored(conflict, index);
            if (accepted) { setText(accepted.text); setError(null); }
        });
    };

    /* One rule for every window: holds the page still, answers Escape (`useModalLayer`). */
    const layer = useModalLayer({ onClose: requestClose, closeDisabled: isSaving });

    if (typeof document === 'undefined') return null;

    return createPortal(
        <>
        <div
            {...layer}
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[110] flex items-center justify-center overscroll-contain bg-black/50"
            onClick={requestClose}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                        {t('audioExport.editChunk', { defaultValue: 'Edit Chunk' })}{!conflict && <> #{chunk.index + 1}</>}
                        {chunk.kind === 'transition' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                                ✨ {t('audioExport.transitionBadge', { defaultValue: 'Переход' })}
                            </span>
                        )}
                    </h3>
                    <button
                        onClick={requestClose}
                        disabled={isSaving}
                        aria-label={t('buttons.close', { defaultValue: 'Close' })}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Textarea */}
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full h-48 p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                    disabled={isSaving}
                />

                {/* Character Count */}
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                    {text.length} / 4000
                </div>

                {/* Error */}
                {error && (!conflict || !('key' in error) || error.key !== 'audioExport.chunksChangedElsewhere') && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm">
                        {sayFailure(error, t)}
                    </div>
                )}

                {conflict && <AudioCorrectionConflict key={conflict.id} conflict={conflict} busy={isSaving} saveDisabled={text.length > 4000}
                    onSave={index => { if (onResolve) void save(() => onResolve(conflict, index, text)); }} onUseStored={takeStored} />}
                {conflict && <button type="button" onClick={() => { void clipboard.copyToClipboard(text); }} disabled={clipboard.isLoading || !text}
                    className="mt-3 text-sm text-blue-700 underline dark:text-blue-300">
                    {clipboard.isCopied ? t('freshness.copiedToast') : t('freshness.copyTextAction')}
                </button>}
                {clipboard.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{t('errors.copyError')}</p>}
                {/* Buttons */}
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={requestClose}
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                        {t('buttons.cancel', { defaultValue: 'Cancel' })}
                    </button>
                    {!conflict && <button
                        onClick={handleSave}
                        disabled={isSaving || text.length > 4000}
                        className="flex-1 px-4 py-2 text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
                    >
                        {isSaving ? t('buttons.saving', { defaultValue: 'Saving...' }) : t('buttons.save', { defaultValue: 'Save' })}
                    </button>}
                </div>
            </div>
        </div>
        {discardDialog}
        </>,
        document.body
    );
}
