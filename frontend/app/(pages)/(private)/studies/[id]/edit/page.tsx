'use client';

import {
    ArrowPathIcon,
    Bars3BottomLeftIcon,
    BookmarkIcon,
    BookOpenIcon,
    CheckCircleIcon,
    CheckIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    QuestionMarkCircleIcon,
    TagIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import NodeTreeEditor from '@/components/studies/node/NodeTreeEditor';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useFlushOnLeave } from '@/hooks/useFlushOnLeave';
import { useNoteAccessGuard } from '@/hooks/useNoteAccessGuard';
import { useStudyNoteDraft } from '@/hooks/useStudyNoteDraft';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { ContentNode } from '@/models/models';
import { makeId } from '@/utils/makeId';
import { markdownToNodeTree } from '@/utils/nodeTreeMigration';

import { BibleLocale } from '../../bibleData';
import ConvertToNodesModal from '../../components/ConvertToNodesModal';
import { STUDIES_INPUT_SHARED_CLASSES } from '../../constants';
import { parseReferenceText } from '../../referenceParser';
import ScriptureRefBadge from '../../ScriptureRefBadge';
import ScriptureRefPicker from '../../ScriptureRefPicker';
import TagCatalogModal from '../../TagCatalogModal';

import type { ReactNode } from 'react';

function withSearchParams(path: string, searchParams: Pick<URLSearchParams, 'toString'>): string {
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
}

function formatSavedTooltip(savedAt: Date, t: ReturnType<typeof useTranslation>['t']): string {
    const diffSec = Math.floor((Date.now() - savedAt.getTime()) / 1000);
    if (diffSec < 5) return t('studiesWorkspace.saveStatus.savedNow');
    if (diffSec < 60) return t('studiesWorkspace.saveStatus.savedSecondsAgo', { count: diffSec });
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return t('studiesWorkspace.saveStatus.savedMinutesAgo', { count: diffMin });
    return t('studiesWorkspace.saveStatus.savedAt', { time: savedAt.toLocaleTimeString() });
}

function SaveStatusBadge({
    t,
    isSaving,
    saveStatus,
    saveError,
    lastSaved,
    showUnsavedHint,
    retrySave,
}: {
    t: ReturnType<typeof useTranslation>['t'];
    isSaving: boolean;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    saveError: string | null;
    lastSaved: Date | null;
    showUnsavedHint: boolean;
    retrySave: () => Promise<void>;
}) {
    let body: ReactNode = null;

    if (saveStatus === 'error') {
        body = (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-200">
                <span>{t('studiesWorkspace.saveStatus.saveFailed')}</span>
                <span aria-hidden="true">&middot;</span>
                <button
                    type="button"
                    onClick={() => {
                        void retrySave();
                    }}
                    className="rounded-full px-1.5 py-0.5 text-xs font-semibold text-red-800 transition hover:bg-red-100 hover:text-red-900 dark:text-red-100 dark:hover:bg-red-900/50"
                >
                    {t('studiesWorkspace.saveStatus.retry')}
                </button>
            </span>
        );
    } else if (isSaving) {
        body = (
            <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                <span>{t('common.saving') || 'Saving...'}</span>
            </>
        );
    } else if (saveError) {
        body = <span className="text-red-500">{saveError}</span>;
    } else if (showUnsavedHint) {
        body = <span className="text-amber-500">{t('studiesWorkspace.unsavedChanges') || 'Unsaved'}</span>;
    } else if (lastSaved) {
        body = (
            <>
                <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                <span className="hidden sm:inline">{t('common.saved') || 'Saved'}</span>
            </>
        );
    }

    return (
        <div
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400"
            title={lastSaved ? formatSavedTooltip(lastSaved, t) : undefined}
        >
            {body}
        </div>
    );
}

function AutoSaveControls({
    t,
    autoSaveEnabled,
    setAutoSaveEnabled,
    hasUnsavedChanges,
    onManualSave,
    isSaving,
    saveStatus,
    saveError,
    lastSaved,
    retrySave,
}: {
    t: ReturnType<typeof useTranslation>['t'];
    autoSaveEnabled: boolean;
    setAutoSaveEnabled: (value: boolean) => void;
    hasUnsavedChanges: boolean;
    onManualSave: () => void;
    isSaving: boolean;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    saveError: string | null;
    lastSaved: Date | null;
    retrySave: () => Promise<void>;
}) {
    return (
        <>
            <label className="hidden cursor-pointer select-none items-center gap-2 sm:flex group">
                <span
                    className={`relative inline-block h-4 w-8 rounded-full transition-colors ${autoSaveEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
                >
                    <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${autoSaveEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </span>
                <input
                    type="checkbox"
                    className="sr-only"
                    checked={autoSaveEnabled}
                    onChange={(event) => setAutoSaveEnabled(event.target.checked)}
                    aria-label={t('studiesWorkspace.autoSave') || 'Autosave'}
                />
                <span className="text-xs text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200">
                    {t('studiesWorkspace.autoSave') || 'Autosave'}
                </span>
            </label>

            {!autoSaveEnabled && (
                <button
                    type="button"
                    onClick={onManualSave}
                    disabled={!hasUnsavedChanges || isSaving}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${hasUnsavedChanges && !isSaving
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                        }`}
                    title={t('common.save') || 'Save'}
                >
                    {isSaving ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save')}
                </button>
            )}

            <SaveStatusBadge
                t={t}
                isSaving={isSaving}
                saveStatus={saveStatus}
                saveError={saveError}
                lastSaved={lastSaved}
                showUnsavedHint={!autoSaveEnabled && hasUnsavedChanges}
                retrySave={retrySave}
            />
        </>
    );
}

function StudyNoteTypeToggle({
    type,
    setType,
    t,
}: {
    type: 'note' | 'question';
    setType: (value: 'note' | 'question') => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setType('note')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'note'
                        ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                        }`}
                >
                    {t('studiesWorkspace.type.note') || 'Note'}
                </button>
                <button
                    type="button"
                    onClick={() => setType('question')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'question'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                        }`}
                >
                    <span className="inline-flex items-center gap-1">
                        <QuestionMarkCircleIcon className="h-3.5 w-3.5" />
                        {t('studiesWorkspace.type.question') || 'Question'}
                    </span>
                </button>
            </div>
        </div>
    );
}

type OutlineEntry = { id: string; label: string; depth: number };

function flattenOutline(root: ContentNode | null): OutlineEntry[] {
    if (!root) return [];
    const entries: OutlineEntry[] = [];
    const walk = (node: ContentNode, depth: number) => {
        const header = node.header?.trim();
        const text = node.text?.trim();
        const label = header || text?.split(/\r?\n/)[0]?.slice(0, 80) || '';
        if (depth > 0 && label) {
            entries.push({ id: node.id, label, depth: depth - 1 });
        }
        node.children?.forEach((child) => walk(child, depth + 1));
    };
    walk(root, 0);
    return entries;
}

function OutlineSidebar({
    t,
    isOpen,
    rootNode,
    onSelect,
    activeId,
}: {
    t: ReturnType<typeof useTranslation>['t'];
    isOpen: boolean;
    rootNode: ContentNode | null;
    onSelect: (nodeId: string) => void;
    activeId?: string | null;
}) {
    const entries = useMemo(() => flattenOutline(rootNode), [rootNode]);
    const title = t('studiesWorkspace.outline.title', { defaultValue: 'Outline' });
    const empty = t('studiesWorkspace.outline.empty', { defaultValue: 'No headings yet' });

    return (
        <aside
            className={`fixed left-0 top-14 bottom-0 z-10 w-72 max-w-[85vw] overflow-y-auto border-r border-gray-200 bg-gray-50/95 backdrop-blur-sm transition-transform duration-200 dark:border-gray-800 dark:bg-gray-950/95 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
            aria-hidden={!isOpen}
            aria-label={title}
        >
            <div className="p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {title}
                </div>
                <nav>
                    {entries.length === 0 ? (
                        <p className="px-2 py-4 text-sm text-gray-400 dark:text-gray-600">{empty}</p>
                    ) : (
                        <OutlineTree entries={entries} onSelect={onSelect} activeId={activeId} />
                    )}
                </nav>
            </div>
        </aside>
    );
}

function OutlineTree({
    entries,
    onSelect,
    activeId,
}: {
    entries: OutlineEntry[];
    onSelect: (id: string) => void;
    activeId?: string | null;
}) {
    return (
        <div className="space-y-px">
            {entries.map((entry) => {
                const isActive = entry.id === activeId;
                return (
                    <button
                        key={entry.id}
                        type="button"
                        onClick={() => onSelect(entry.id)}
                        title={entry.label}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                            isActive
                                ? 'bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-50'
                        }`}
                        style={{ paddingLeft: `${0.5 + entry.depth * 0.75}rem` }}
                    >
                        <span
                            className={`h-1.5 w-1.5 flex-none rounded-full ${
                                isActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        />
                        <span className="truncate">{entry.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

function StudyNoteEditHeader({
    t,
    type,
    setType,
    title,
    setTitle,
    titleInputRef,
    onToggleOutline,
    isOutlineOpen,
    isSaving,
    saveStatus,
    saveError,
    lastSaved,
    autoSaveEnabled,
    setAutoSaveEnabled,
    hasUnsavedChanges,
    onManualSave,
    retrySave,
    onDone,
    isFinishing,
}: {
    t: ReturnType<typeof useTranslation>['t'];
    type: 'note' | 'question';
    setType: (value: 'note' | 'question') => void;
    title: string;
    setTitle: (value: string) => void;
    titleInputRef: React.MutableRefObject<HTMLInputElement | null>;
    onToggleOutline: () => void;
    isOutlineOpen: boolean;
    isSaving: boolean;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    saveError: string | null;
    lastSaved: Date | null;
    autoSaveEnabled: boolean;
    setAutoSaveEnabled: (value: boolean) => void;
    hasUnsavedChanges: boolean;
    onManualSave: () => void;
    retrySave: () => Promise<void>;
    onDone: () => void;
    isFinishing: boolean;
}) {
    const doneLabel = t('common.done') || 'Done';
    const outlineLabel = t('studiesWorkspace.outline.toggle', { defaultValue: 'Outline' });

    return (
        <header className="sticky top-0 z-30 flex h-14 flex-nowrap items-center gap-x-4 border-b border-gray-200 bg-white/90 px-4 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90 sm:px-6">
            <button
                type="button"
                onClick={onToggleOutline}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                    isOutlineOpen
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                }`}
                title={outlineLabel}
                aria-label={outlineLabel}
                aria-pressed={isOutlineOpen}
            >
                <Bars3BottomLeftIcon className="h-5 w-5" />
            </button>
            <StudyNoteTypeToggle type={type} setType={setType} t={t} />

            <div className="order-3 w-full min-w-0 flex-1 md:order-2 md:w-auto">
                <input
                    ref={titleInputRef}
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={t('studiesWorkspace.titlePlaceholder') || 'Note Title...'}
                    className="w-full border-none bg-transparent text-center text-lg font-semibold tracking-tight text-gray-900 outline-none placeholder:text-gray-300 dark:text-gray-50 dark:placeholder:text-gray-700 md:text-xl"
                />
            </div>

            <div className="order-2 ml-auto flex items-center gap-3 md:order-3 md:ml-0">
                <AutoSaveControls
                    t={t}
                    autoSaveEnabled={autoSaveEnabled}
                    setAutoSaveEnabled={setAutoSaveEnabled}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onManualSave={onManualSave}
                    isSaving={isSaving}
                    saveStatus={saveStatus}
                    saveError={saveError}
                    lastSaved={lastSaved}
                    retrySave={retrySave}
                />
                <button
                    type="button"
                    onClick={onDone}
                    disabled={isFinishing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    title={doneLabel}
                    aria-label={doneLabel}
                >
                    {isFinishing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    <span>{doneLabel}</span>
                </button>
            </div>
        </header>
    );
}

export default function StudyNoteFocusEditorPage() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const noteId = params.id as string;

    const { notes, loading: notesLoading, error: notesError } = useStudyNotes();
    const {
        draft: { title, content, tags, scriptureRefs, type, rootNode },
        setters: { setTitle, setContent, setTags, setScriptureRefs, setType, setRootNode },
        autoSave: {
            isSaving,
            saveStatus,
            lastSaved,
            saveError,
            hasUnsavedChanges,
            flushSave,
            retrySave,
            autoSaveEnabled,
            setAutoSaveEnabled,
        },
        meta: { isInitialized, existingNote, isNew, uid },
    } = useStudyNoteDraft(noteId);
    useFlushOnLeave(flushSave, hasUnsavedChanges);
    useNoteAccessGuard({ noteId, isNew, notesLoading, error: notesError, existingNote, uid, redirectTo: '/studies' });

    const { tags: tagData } = useTags(uid);

    const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
    const [tagInput, setTagInput] = useState('');
    const [quickRefInput, setQuickRefInput] = useState('');
    const [quickRefError, setQuickRefError] = useState<string | null>(null);
    const [showTagCatalog, setShowTagCatalog] = useState(false);
    const [editingRefIndex, setEditingRefIndex] = useState<number | null>(null);
    const [showRefPicker, setShowRefPicker] = useState(false);
    const [isFinishing, setIsFinishing] = useState(false);
    const [isOutlineOpen, setIsOutlineOpen] = useState(false);
    const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);

    const handleOutlineSelect = useCallback((nodeId: string) => {
        setActiveOutlineId(nodeId);
        const target = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);
    const finishingRef = useRef(false);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const hasFocusedTitleRef = useRef(false);

    const bibleLocale: BibleLocale = useMemo(() => {
        const lang = i18n.language?.toLowerCase() || 'en';
        if (lang.startsWith('ru')) return 'ru';
        if (lang.startsWith('uk')) return 'uk';
        return 'en';
    }, [i18n.language]);

    const availableTags = useMemo(() => {
        const fromTags = [...(tagData.requiredTags ?? []), ...(tagData.customTags ?? [])].map((tag) => tag.name);
        const fromNotes = new Set<string>();
        notes.forEach((note) => note.tags.forEach((tag) => fromNotes.add(tag)));
        return Array.from(new Set([...fromTags, ...Array.from(fromNotes)])).sort((a, b) => a.localeCompare(b));
    }, [tagData, notes]);

    const displaySaveError = typeof saveError === 'string' ? saveError : null;
    const nodeEditorOptIn = searchParams.get('nodes') === '1';

    useEffect(() => {
        if (hasFocusedTitleRef.current || !isInitialized) return;
        if (existingNote === undefined || existingNote.title === '') {
            titleInputRef.current?.focus();
            hasFocusedTitleRef.current = true;
        }
    }, [existingNote, isInitialized]);

    const handleDone = useCallback(async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        setIsFinishing(true);

        try {
            await flushSave();
            const targetId = existingNote?.id ?? noteId;
            router.push(withSearchParams(`/studies/${targetId}`, searchParams));
        } catch (error) {
            console.error('Error saving study note before leaving edit mode', error);
            finishingRef.current = false;
            setIsFinishing(false);
        }
    }, [existingNote?.id, flushSave, noteId, router, searchParams]);

    const replacedCreatedNoteIdRef = useRef<string | null>(null);
    useEffect(() => {
        const createdNoteId = noteId === 'new' ? existingNote?.id : null;
        if (!createdNoteId || replacedCreatedNoteIdRef.current === createdNoteId) return;

        replacedCreatedNoteIdRef.current = createdNoteId;
        router.replace(withSearchParams(`/studies/${createdNoteId}/edit`, searchParams));
    }, [existingNote?.id, noteId, router, searchParams]);

    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null): boolean =>
            target instanceof HTMLElement
            && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && (event.key === 'e' || event.key === 'E'))) {
                if (isTypingTarget(event.target)) return;
                event.preventDefault();
                void handleDone();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleDone]);

    const handleConfirmConvertToNodes = useCallback((nextRootNode: ContentNode): void => {
        setRootNode(nextRootNode);
        setIsConvertModalOpen(false);
        toast.success(t('studiesWorkspace.convertModal.undoToast'), {
            action: {
                label: t('studiesWorkspace.convertModal.undoAction'),
                onClick: () => setRootNode(null),
            },
        });
    }, [setRootNode, t]);

    const addTag = useCallback(() => {
        const value = tagInput.trim();
        if (!value) return;
        setTags((prev) => Array.from(new Set([...prev, value])));
        setTagInput('');
    }, [setTags, tagInput]);

    const toggleTag = useCallback((tag: string) => {
        setTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
    }, [setTags]);

    if (notesLoading || (!isInitialized && !isNew)) {
        return (
            <div className="flex items-center justify-center p-12">
                <ArrowPathIcon className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
        );
    }

    const isFreshlyEmpty = Boolean(existingNote) && !existingNote?.content && !existingNote?.rootNode;
    const useNodeEditor = isNew || isFreshlyEmpty || Boolean(rootNode) || Boolean(existingNote?.rootNode) || nodeEditorOptIn;
    const effectiveRoot = rootNode
        ?? existingNote?.rootNode
        ?? (content.trim() ? markdownToNodeTree(content) : { id: makeId(), children: [] });

    return (
        <div className="relative -m-4 flex min-h-screen flex-col bg-white dark:bg-gray-900 md:-m-6 lg:-m-8">
            <OutlineSidebar
                t={t}
                isOpen={isOutlineOpen}
                rootNode={effectiveRoot}
                onSelect={handleOutlineSelect}
                activeId={activeOutlineId}
            />
            <StudyNoteEditHeader
                t={t}
                type={type}
                setType={setType}
                title={title}
                setTitle={setTitle}
                titleInputRef={titleInputRef}
                onToggleOutline={() => setIsOutlineOpen((v) => !v)}
                isOutlineOpen={isOutlineOpen}
                isSaving={isSaving}
                saveStatus={saveStatus}
                saveError={displaySaveError}
                lastSaved={lastSaved}
                autoSaveEnabled={autoSaveEnabled}
                setAutoSaveEnabled={setAutoSaveEnabled}
                hasUnsavedChanges={hasUnsavedChanges}
                onManualSave={() => {
                    void flushSave();
                }}
                retrySave={retrySave}
                onDone={() => {
                    void handleDone();
                }}
                isFinishing={isFinishing}
            />

            <div className={`mx-auto w-full flex-1 space-y-8 px-4 py-3 transition-[padding-left] duration-200 md:px-12 md:py-6 md:pb-32 ${isOutlineOpen ? 'md:pl-[18rem]' : ''}`}>
                <div className="relative px-1 py-2 md:px-4 md:py-6">
                    {useNodeEditor ? (
                        <div className="text-lg leading-relaxed md:text-xl">
                            <NodeTreeEditor
                                rootNode={effectiveRoot}
                                onChange={setRootNode}
                                autoFocusFirst={!rootNode}
                                currentNoteId={isNew ? undefined : noteId}
                            />
                        </div>
                    ) : (
                        <div className="text-lg leading-relaxed md:text-xl">
                            <RichMarkdownEditor
                                value={content}
                                onChange={setContent}
                                placeholder={t('studiesWorkspace.contentPlaceholder') || 'Start typing your thoughts here...'}
                                minHeight="300px"
                            />
                            {content.trim() && (
                                <button
                                    type="button"
                                    onClick={() => setIsConvertModalOpen(true)}
                                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                                    title={t('studiesWorkspace.convertToNodesHint') || 'Convert markdown headings into nested nodes'}
                                >
                                    {t('studiesWorkspace.convertToNodes') || 'Convert to nodes'}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-8 border-t border-gray-200 pt-8 dark:border-gray-700 md:grid-cols-2">
                    <div className="flex h-full flex-col space-y-4 group/refs">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.scriptureRefs')}>
                                <BookmarkIcon className="h-5 w-5" />
                                <span className="text-sm font-medium">{t('studiesWorkspace.scriptureRefs')}</span>
                            </div>
                        </div>

                        {scriptureRefs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {scriptureRefs.map((ref, index) => (
                                    <ScriptureRefBadge
                                        key={ref.id}
                                        reference={ref}
                                        isEditing={editingRefIndex === index}
                                        onClick={() => {
                                            setEditingRefIndex(index);
                                            setShowRefPicker(false);
                                        }}
                                        onRemove={() => setScriptureRefs((prev) => prev.filter((_, refIndex) => refIndex !== index))}
                                    />
                                ))}
                            </div>
                        )}

                        <div className="mt-auto flex items-center gap-2 pt-2">
                            <input
                                value={quickRefInput}
                                onChange={(event) => {
                                    setQuickRefInput(event.target.value);
                                    setQuickRefError(null);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return;
                                    event.preventDefault();
                                    const parsed = parseReferenceText(quickRefInput.trim(), bibleLocale);
                                    if (!parsed) {
                                        setQuickRefError(t('studiesWorkspace.quickRefError') || 'Cannot parse');
                                        return;
                                    }
                                    setScriptureRefs((prev) => [...prev, { ...parsed, id: makeId() }]);
                                    setQuickRefInput('');
                                }}
                                placeholder={t('studiesWorkspace.quickRefPlaceholder')}
                                className={`flex-1 ${STUDIES_INPUT_SHARED_CLASSES} py-1.5`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowRefPicker(true)}
                                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-gray-800"
                                title={t('studiesWorkspace.browseBooks')}
                            >
                                <BookOpenIcon className="h-5 w-5" />
                            </button>
                        </div>
                        {quickRefError && <p className="mt-1 text-xs text-red-500">{quickRefError}</p>}

                        {showRefPicker && (
                            <ScriptureRefPicker
                                mode="add"
                                onConfirm={(ref) => {
                                    setScriptureRefs((prev) => [...prev, { ...ref, id: makeId() }]);
                                    setShowRefPicker(false);
                                }}
                                onCancel={() => setShowRefPicker(false)}
                            />
                        )}

                        {editingRefIndex !== null && (
                            <ScriptureRefPicker
                                mode="edit"
                                initialRef={scriptureRefs[editingRefIndex]}
                                onConfirm={(ref) => {
                                    setScriptureRefs((prev) => {
                                        const next = [...prev];
                                        next[editingRefIndex] = { ...ref, id: next[editingRefIndex].id };
                                        return next;
                                    });
                                    setEditingRefIndex(null);
                                }}
                                onCancel={() => setEditingRefIndex(null)}
                            />
                        )}
                    </div>

                    <div className="flex h-full flex-col space-y-4 group/tags">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.tags')}>
                                <TagIcon className="h-5 w-5" />
                                <span className="text-sm font-medium">{t('studiesWorkspace.tags')}</span>
                            </div>
                        </div>

                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                                    >
                                        {tag}
                                        <button
                                            type="button"
                                            onClick={() => toggleTag(tag)}
                                            className="ml-1 hover:text-emerald-900 dark:hover:text-emerald-100"
                                        >
                                            <XMarkIcon className="h-3.5 w-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="mt-auto flex items-center gap-2 pt-2">
                            <input
                                value={tagInput}
                                onChange={(event) => setTagInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addTag();
                                    }
                                }}
                                placeholder={t('studiesWorkspace.addTag')}
                                className={`flex-1 ${STUDIES_INPUT_SHARED_CLASSES} py-1.5`}
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-gray-800"
                            >
                                <PlusIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowTagCatalog(true)}
                                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-gray-800"
                                title={t('studiesWorkspace.browseTags', { defaultValue: 'Browse tags' })}
                            >
                                <MagnifyingGlassIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <TagCatalogModal
                isOpen={showTagCatalog}
                onClose={() => setShowTagCatalog(false)}
                availableTags={availableTags}
                selectedTags={tags}
                onToggleTag={toggleTag}
            />

            <ConvertToNodesModal
                open={isConvertModalOpen}
                sourceContent={content}
                onConfirm={handleConfirmConvertToNodes}
                onCancel={() => setIsConvertModalOpen(false)}
            />
        </div>
    );
}
