'use client';

import { SparklesIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiBusyComet } from '@/components/ui/AiBusyComet';

export type NoteAiTarget = 'all' | 'title' | 'scriptureRefs' | 'tags';

/**
 * Which control started the run. The busy animation belongs to the button the person
 * PRESSED, not to what the model was asked for: choosing "Find Scripture Refs" inside
 * this header menu has to light this header button, never the small one beside the
 * reference list. One shared boolean could not tell those apart, so it lit whichever
 * button happened to own a spinner.
 */
export type NoteAiSource = 'menu' | 'scriptureRefs' | 'tags';

interface NoteAiMenuProps {
    onAnalyze: (target: NoteAiTarget) => void;
    /** True only while THIS button's request is in flight. */
    isRunning: boolean;
    disabled: boolean;
    /** Shown instead of the normal tooltip when the AI quota is spent. */
    blockedTitle?: string;
}

/**
 * The note-level AI actions. Extracted from the page so it can sit in the header
 * beside the note's title — it acts on the WHOLE note, never on the text under the
 * cursor, so it belongs next to the thing it rewrites.
 */
export function NoteAiMenu({ onAnalyze, isRunning, disabled, blockedTitle }: NoteAiMenuProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const pick = (target: NoteAiTarget) => {
        setIsOpen(false);
        onAnalyze(target);
    };

    return (
        <div className="relative shrink-0" ref={rootRef}>
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                disabled={disabled}
                aria-busy={isRunning}
                title={isRunning
                    ? t('studiesWorkspace.aiAnalyze.analyzing')
                    : blockedTitle || t('studiesWorkspace.aiAnalyze.button')}
                aria-label={t('studiesWorkspace.aiAnalyze.button')}
                // No `overflow-hidden`: the comet orbits OUTSIDE the pill.
                // `disabled:opacity-50` is suspended while it runs — a working control must
                // not look like a dead one.
                className={`relative flex h-9 w-9 items-center justify-center rounded-full border border-purple-400 bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow transition-all hover:from-purple-600 hover:to-indigo-600 dark:border-purple-600 ${isRunning ? 'opacity-100' : 'disabled:opacity-50'}`}
            >
                {isRunning && <AiBusyComet />}
                <SparklesIcon className="relative h-5 w-5" />
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-xl border border-gray-100 bg-white py-2 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-1 border-b border-gray-50 px-4 py-2 dark:border-gray-700/50">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('studiesWorkspace.aiAnalyze.popoverTitle', { defaultValue: 'AI Actions' })}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => pick('all')}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                    >
                        {t('studiesWorkspace.aiAnalyze.full', { defaultValue: 'Full Analysis' })}
                    </button>
                    <button
                        type="button"
                        onClick={() => pick('title')}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                    >
                        {t('studiesWorkspace.aiAnalyze.generateTitle', { defaultValue: 'Generate Title' })}
                    </button>
                    <button
                        type="button"
                        onClick={() => pick('scriptureRefs')}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                    >
                        {t('studiesWorkspace.aiAnalyze.findRefs', { defaultValue: 'Find Scripture Refs' })}
                    </button>
                    <button
                        type="button"
                        onClick={() => pick('tags')}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                    >
                        {t('studiesWorkspace.aiAnalyze.generateTags', { defaultValue: 'Generate Tags' })}
                    </button>
                </div>
            )}
        </div>
    );
}

export default NoteAiMenu;
