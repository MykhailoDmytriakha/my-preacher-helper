/**
 * Chunk Editor Modal
 * 
 * Modal for editing a single audio chunk text.
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// Types
// ============================================================================

interface ChunkEditorModalProps {
    chunk: {
        index: number;
        text: string;
    };
    onSave: (index: number, newText: string) => Promise<void>;
    onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export default function ChunkEditorModal({
    chunk,
    onSave,
    onClose,
}: ChunkEditorModalProps) {
    const { t } = useTranslation();
    const [text, setText] = useState(chunk.text);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        setError(null);

        try {
            await onSave(chunk.index, text);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setIsSaving(false);
        }
    }, [chunk.index, text, onSave]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {t('audioExport.editChunk', { defaultValue: 'Edit Chunk' })} #{chunk.index + 1}
                    </h3>
                    <button
                        onClick={onClose}
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
                    className="w-full h-48 p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                    disabled={isSaving}
                />

                {/* Character Count */}
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                    {text.length} / 4000
                </div>

                {/* Error */}
                {error && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm">
                        {error}
                    </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                        {t('buttons.cancel', { defaultValue: 'Cancel' })}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || text.length > 4000}
                        className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isSaving ? t('buttons.saving', { defaultValue: 'Saving...' }) : t('buttons.save', { defaultValue: 'Save' })}
                    </button>
                </div>
            </div>
        </div>
    );
}
