'use client';

import { XMarkIcon, CheckIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ScriptureReference } from '@/models/models';

import { getLocalizedBookName, BibleLocale } from './bibleData';

export interface AnalysisResultData {
    title?: string;
    tags?: string[];
    scriptureRefs?: ScriptureReference[];
}

interface AnalysisConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (data: AnalysisResultData) => void;
    result: AnalysisResultData | null;
    bibleLocale: BibleLocale;
    currentTitle?: string;
    currentTags?: string[];
    currentScriptureRefs?: ScriptureReference[];
}

export default function AnalysisConfirmationModal({
    isOpen,
    onClose,
    onApply,
    result,
    bibleLocale,
    currentTitle,
    currentTags,
    currentScriptureRefs,
}: AnalysisConfirmationModalProps) {
    const { t } = useTranslation();
    const modalRef = useRef<HTMLDivElement>(null);

    const [applyTitle, setApplyTitle] = useState(true);
    const [applyTags, setApplyTags] = useState(true);
    const [applyRefs, setApplyRefs] = useState(true);

    useEffect(() => {
        if (result) {
            setApplyTitle(result.title !== undefined);
            setApplyTags(result.tags !== undefined);
            setApplyRefs(result.scriptureRefs !== undefined);
        }
    }, [result]);

    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(event: MouseEvent) {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        document.body.style.overflow = isOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!isOpen || !result) return null;

    const handleApply = () => {
        onApply({
            title: applyTitle ? result.title : undefined,
            tags: applyTags ? result.tags : undefined,
            scriptureRefs: applyRefs ? result.scriptureRefs : undefined,
        });
        onClose();
    };

    const hasTitle = result.title !== undefined;
    const hasTags = result.tags !== undefined;
    const hasRefs = result.scriptureRefs !== undefined;

    const formatRef = (ref: ScriptureReference) => {
        const bookName = getLocalizedBookName(ref.book, bibleLocale);
        if (!ref.chapter) return bookName;
        if (!ref.fromVerse) {
            if (ref.toChapter && ref.toChapter !== ref.chapter) {
                return `${bookName} ${ref.chapter}–${ref.toChapter}`;
            }
            return `${bookName} ${ref.chapter}`;
        }
        let text = `${bookName} ${ref.chapter}:${ref.fromVerse}`;
        if (ref.toVerse && ref.toVerse !== ref.fromVerse) text += `–${ref.toVerse}`;
        return text;
    };

    // Tags diff — merge semantics: only new items matter
    const currentTagsSet = new Set(currentTags || []);
    const resultTags = result.tags || [];
    const addedTags = resultTags.filter(tag => !currentTagsSet.has(tag));
    const keptTags = resultTags.filter(tag => currentTagsSet.has(tag));

    // Refs diff — merge semantics: only new items matter
    const currentRefKeys = new Set((currentScriptureRefs || []).map(formatRef));
    const resultRefs = result.scriptureRefs || [];
    const addedRefs = resultRefs.filter(r => !currentRefKeys.has(formatRef(r)));
    const keptRefs = resultRefs.filter(r => currentRefKeys.has(formatRef(r)));

    const titleChanged = hasTitle && currentTitle !== result.title;
    const titleIsNew = hasTitle && !currentTitle?.trim();

    const nothingToApply = !hasTitle && !hasTags && !hasRefs;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />

            <div
                ref={modalRef}
                className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 flex flex-col max-h-[90vh]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="analysis-modal-title"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700 shrink-0">
                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                        <CheckCircleIcon className="h-6 w-6" />
                        <h2 id="analysis-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                            {t('studiesWorkspace.aiAnalyze.resultsTitle', { defaultValue: 'AI Analysis Results' })}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-5 overflow-y-auto space-y-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('studiesWorkspace.aiAnalyze.resultsDescMerge', { defaultValue: 'New items will be added to your note. Existing items are kept.' })}
                    </p>

                    {/* Title */}
                    {hasTitle && (
                        <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-700/50">
                            <input
                                type="checkbox"
                                checked={applyTitle}
                                onChange={(e) => setApplyTitle(e.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-gray-300 text-purple-600 focus:ring-purple-600 dark:border-gray-600 dark:bg-gray-700"
                            />
                            <div className="flex flex-col flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {t('studiesWorkspace.title', { defaultValue: 'Title' })}
                                    {titleChanged && (
                                        <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
                                            {t('studiesWorkspace.aiAnalyze.titleWillReplace', { defaultValue: 'will replace current' })}
                                        </span>
                                    )}
                                </span>
                                <div className="mt-1.5 flex flex-col gap-1">
                                    {titleChanged && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500 break-words">
                                            {currentTitle}
                                        </span>
                                    )}
                                    <span className={`text-base font-semibold break-words ${titleIsNew ? 'text-green-600 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                        {result.title}
                                    </span>
                                </div>
                            </div>
                        </label>
                    )}

                    {/* Tags */}
                    {hasTags && (
                        <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-700/50">
                            <input
                                type="checkbox"
                                checked={applyTags}
                                onChange={(e) => setApplyTags(e.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-gray-300 text-purple-600 focus:ring-purple-600 dark:border-gray-600 dark:bg-gray-700"
                            />
                            <div className="flex flex-col w-full min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('studiesWorkspace.tags', { defaultValue: 'Tags' })}
                                    </span>
                                    {addedTags.length > 0 && (
                                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/50 dark:text-green-300">
                                            +{addedTags.length} {t('studiesWorkspace.aiAnalyze.newLabel', { defaultValue: 'new' })}
                                        </span>
                                    )}
                                    {keptTags.length > 0 && addedTags.length === 0 && (
                                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                            {t('studiesWorkspace.aiAnalyze.allAlreadyIn', { defaultValue: 'already in note' })}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {keptTags.map((tag, idx) => (
                                        <span key={`kept-${idx}`} className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                                            {tag}
                                        </span>
                                    ))}
                                    {addedTags.map((tag, idx) => (
                                        <span key={`added-${idx}`} className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/50 dark:text-green-200 border border-green-200 dark:border-green-800">
                                            <span className="mr-1 opacity-60">+</span>{tag}
                                        </span>
                                    ))}
                                    {!keptTags.length && !addedTags.length && (
                                        <span className="text-sm text-gray-400 italic">
                                            {t('studiesWorkspace.aiAnalyze.noNewTags', { defaultValue: 'No new tags suggested' })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </label>
                    )}

                    {/* Scripture Refs */}
                    {hasRefs && (
                        <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-700/50">
                            <input
                                type="checkbox"
                                checked={applyRefs}
                                onChange={(e) => setApplyRefs(e.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-gray-300 text-purple-600 focus:ring-purple-600 dark:border-gray-600 dark:bg-gray-700"
                            />
                            <div className="flex flex-col w-full min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('studiesWorkspace.scriptureRefs', { defaultValue: 'Scripture References' })}
                                    </span>
                                    {addedRefs.length > 0 && (
                                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/50 dark:text-green-300">
                                            +{addedRefs.length} {t('studiesWorkspace.aiAnalyze.newLabel', { defaultValue: 'new' })}
                                        </span>
                                    )}
                                    {keptRefs.length > 0 && addedRefs.length === 0 && (
                                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                            {t('studiesWorkspace.aiAnalyze.allAlreadyIn', { defaultValue: 'already in note' })}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {keptRefs.map((ref, idx) => (
                                        <span key={`kept-${idx}`} className="inline-flex items-center rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                            {formatRef(ref)}
                                        </span>
                                    ))}
                                    {addedRefs.map((ref, idx) => (
                                        <span key={`added-${idx}`} className="inline-flex items-center rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/50 dark:text-green-200 border border-green-200 dark:border-green-800">
                                            <span className="mr-1 opacity-60">+</span>{formatRef(ref)}
                                        </span>
                                    ))}
                                    {!keptRefs.length && !addedRefs.length && (
                                        <span className="text-sm text-gray-400 italic">
                                            {t('studiesWorkspace.aiAnalyze.noNewRefs', { defaultValue: 'No new references suggested' })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </label>
                    )}

                    {nothingToApply && (
                        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                            {t('studiesWorkspace.aiAnalyze.noResults', { defaultValue: 'No suggestions found for this content.' })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 bg-gray-50/50 px-6 py-4 dark:border-gray-700 dark:bg-gray-800/50 shrink-0 rounded-b-2xl">
                    <div className="flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={nothingToApply}
                            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <CheckIcon className="h-4 w-4" />
                            {t('studiesWorkspace.aiAnalyze.applySelected', { defaultValue: 'Apply Selected' })}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
