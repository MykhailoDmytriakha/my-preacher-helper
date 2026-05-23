'use client';

import {
    ArrowLeftIcon,
    ArrowPathIcon,
    BookmarkIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    DocumentDuplicateIcon,
    EllipsisVerticalIcon,
    LinkIcon,
    PencilIcon,
    QuestionMarkCircleIcon,
    TagIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NodeTreeEditor from '@/components/studies/node/NodeTreeEditor';
import { useClipboard } from '@/hooks/useClipboard';
import { useNoteAccessGuard } from '@/hooks/useNoteAccessGuard';
import { useStudyNoteDraft } from '@/hooks/useStudyNoteDraft';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useWikilinkResolver } from '@/hooks/useWikilinkResolver';
import { StudyNote } from '@/models/models';
import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { getStudyText } from '@/utils/nodeTreeAdapter';
import { formatStudyNoteForCopy } from '@/utils/studyNoteUtils';
import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { BibleLocale, getLocalizedBookName } from '../bibleData';
import KeyboardCheatsheet from '../components/KeyboardCheatsheet';
import ShareNoteModal from '../components/ShareNoteModal';
import ScriptureRefBadge from '../ScriptureRefBadge';

type SearchParamsLike = Pick<URLSearchParams, 'toString'>;

function withSearchParams(path: string, searchParams: SearchParamsLike): string {
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
}

// Local helper until API has a specific noteId delete.
const deleteStudyNoteShareLinkByNoteId = async (
    userId: string,
    noteId: string,
    currentLinks: { noteId: string; id: string }[]
) => {
    const link = currentLinks.find((item) => item.noteId === noteId);
    if (link) {
        await deleteStudyNoteShareLink(userId, link.id);
    }
};

function useFilteredNotes(notes: StudyNote[], noteId: string, searchParams: SearchParamsLike, bibleLocale: BibleLocale) {
    const searchParamString = searchParams.toString();
    const parsedSearchParams = useMemo(() => new URLSearchParams(searchParamString), [searchParamString]);
    const searchQuery = parsedSearchParams.get('search')?.trim() || '';
    const tagFilter = parsedSearchParams.get('tag') || '';
    const bookFilter = parsedSearchParams.get('book') || '';
    const activeTab = parsedSearchParams.get('tab') || 'all';
    const searchTokens = useMemo(() => searchQuery.toLowerCase().split(/\s+/).filter(Boolean), [searchQuery]);

    const filteredNotes = useMemo(() => {
        return notes
            .filter((note) => {
                if (activeTab === 'notes') return note.type !== 'question';
                if (activeTab === 'questions') return note.type === 'question';
                return true;
            })
            .filter((note) => (tagFilter ? note.tags.includes(tagFilter) : true))
            .filter((note) => (
                bookFilter
                    ? note.scriptureRefs.some((ref) => ref.book.toLowerCase() === bookFilter.toLowerCase())
                    : true
            ))
            .filter((note) => {
                if (searchTokens.length === 0) return true;
                const refs = note.scriptureRefs
                    .map((ref) => `${getLocalizedBookName(ref.book, bibleLocale)} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`)
                    .join(' ');
                const haystack = `${note.title} ${getStudyText(note)} ${note.tags.join(' ')} ${refs}`.toLowerCase();
                return searchTokens.every((token) => haystack.includes(token));
            })
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }, [notes, activeTab, tagFilter, bookFilter, searchTokens, bibleLocale]);

    const currentIndex = useMemo(() => filteredNotes.findIndex((note) => note.id === noteId), [filteredNotes, noteId]);
    const prevNoteId = currentIndex > 0 ? filteredNotes[currentIndex - 1].id : null;
    const nextNoteId = currentIndex >= 0 && currentIndex < filteredNotes.length - 1
        ? filteredNotes[currentIndex + 1].id
        : null;

    return { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery };
}

function useNoteKeyboardNavigation({
    noteId,
    prevNoteId,
    nextNoteId,
    router,
    searchParams,
}: {
    noteId: string;
    prevNoteId: string | null;
    nextNoteId: string | null;
    router: ReturnType<typeof useRouter>;
    searchParams: SearchParamsLike;
}) {
    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null): boolean =>
            target instanceof HTMLTextAreaElement
            || target instanceof HTMLInputElement
            || (target instanceof HTMLElement && target.isContentEditable);

        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (isTypingTarget(event.target)) return;

            if ((event.metaKey || event.ctrlKey) && (event.key === 'e' || event.key === 'E')) {
                event.preventDefault();
                router.push(withSearchParams(`/studies/${noteId}/edit`, searchParams));
                return;
            }

            if (event.key === 'ArrowLeft' && prevNoteId) {
                router.push(withSearchParams(`/studies/${prevNoteId}`, searchParams));
            } else if (event.key === 'ArrowRight' && nextNoteId) {
                router.push(withSearchParams(`/studies/${nextNoteId}`, searchParams));
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [noteId, prevNoteId, nextNoteId, router, searchParams]);
}

type DeleteNoteFn = (id: string) => Promise<unknown>;

function useNoteDeletion({
    t,
    noteId,
    isNew,
    uid,
    deleteNote,
    router,
}: {
    t: ReturnType<typeof useTranslation>['t'];
    noteId: string;
    isNew: boolean;
    uid: string | undefined;
    deleteNote: DeleteNoteFn;
    router: ReturnType<typeof useRouter>;
}) {
    return async () => {
        if (!window.confirm(t('studiesWorkspace.deleteConfirm'))) return;

        if (noteId && !isNew && uid) {
            try {
                await deleteNote(noteId);
            } catch (error) {
                console.error('Error deleting note', error);
            }

            try {
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE || ''}/api/studies/share-links?userId=${uid}`);
                if (response.ok) {
                    const links = await response.json() as { noteId: string; id: string }[];
                    await deleteStudyNoteShareLinkByNoteId(uid, noteId, links);
                }
            } catch (error) {
                console.error('Error deleting share link', error);
            }
        }

        router.push('/studies');
    };
}

function StudyNoteTypeBadge({
    type,
    t,
}: {
    type: 'note' | 'question';
    t: ReturnType<typeof useTranslation>['t'];
}) {
    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2">
                {type === 'question' ? (
                    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-500/30">
                        <QuestionMarkCircleIcon className="mr-1 h-3.5 w-3.5" />
                        {t('studiesWorkspace.type.question') || 'Question'}
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-800/50 dark:text-gray-400 dark:ring-gray-700/50">
                        {t('studiesWorkspace.type.note') || 'Note'}
                    </span>
                )}
            </div>
        </div>
    );
}

function StudyNoteViewHeader({
    handleBack,
    handleCopy,
    handleDelete,
    handleEdit,
    handleShare,
    isCopied,
    hasShareLink,
    t,
    filteredNotes,
    prevNoteId,
    nextNoteId,
    router,
    searchParams,
    currentIndex,
    type,
}: {
    handleBack: () => void;
    handleCopy: () => void;
    handleDelete: () => void;
    handleEdit: () => void;
    handleShare: () => void;
    isCopied: boolean;
    hasShareLink: boolean;
    t: ReturnType<typeof useTranslation>['t'];
    filteredNotes: StudyNote[];
    prevNoteId: string | null;
    nextNoteId: string | null;
    router: ReturnType<typeof useRouter>;
    searchParams: SearchParamsLike;
    currentIndex: number;
    type: 'note' | 'question';
}) {
    const [showMenu, setShowMenu] = useState(false);
    const [isCheatsheetOpen, setIsCheatsheetOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const copyLabel = isCopied ? t('common.copied') || 'Copied!' : t('common.copy') || 'Copy';

    useEffect(() => {
        if (!showMenu) return undefined;

        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    return (
        <>
            <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/80 sm:px-6">
                <div className="flex items-center gap-1 sm:gap-2 lg:gap-4">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={handleBack}
                            className="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                            title={t('common.back')}
                        >
                            <ArrowLeftIcon className="h-5 w-5" />
                        </button>

                        {filteredNotes.length > 1 && (
                            <div className="flex items-center gap-0.5 border-l border-gray-200 pl-2 dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (prevNoteId) router.push(withSearchParams(`/studies/${prevNoteId}`, searchParams));
                                    }}
                                    disabled={!prevNoteId}
                                    className="flex items-center justify-center rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                                    title={t('common.previous') || 'Previous (←)'}
                                >
                                    <ChevronLeftIcon className="h-4 w-4" />
                                </button>
                                <span className="min-w-[3rem] select-none text-center font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">
                                    {currentIndex >= 0 ? `${currentIndex + 1} / ${filteredNotes.length}` : '-'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (nextNoteId) router.push(withSearchParams(`/studies/${nextNoteId}`, searchParams));
                                    }}
                                    disabled={!nextNoteId}
                                    className="flex items-center justify-center rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                                    title={t('common.next') || 'Next (→)'}
                                >
                                    <ChevronRightIcon className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </div>

                    <StudyNoteTypeBadge type={type} t={t} />
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setIsCheatsheetOpen(true)}
                        className="hidden items-center justify-center rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 md:inline-flex"
                        title={t('studiesWorkspace.cheatsheet.buttonLabel') || 'Keyboard shortcuts'}
                        aria-label={t('studiesWorkspace.cheatsheet.buttonLabel') || 'Keyboard shortcuts'}
                    >
                        <span className="text-sm font-semibold">?</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleShare}
                        className={`rounded-lg p-2 transition-colors ${hasShareLink
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                            }`}
                        title={t('studiesWorkspace.shareLinks.shareButton')}
                        aria-label={t('studiesWorkspace.shareLinks.shareButton')}
                    >
                        <LinkIcon className="h-5 w-5" />
                    </button>

                    <button
                        type="button"
                        onClick={handleCopy}
                        className={`rounded-lg p-2 transition-colors ${isCopied
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                            }`}
                        title={copyLabel}
                        aria-label={copyLabel}
                    >
                        {isCopied ? <CheckIcon className="h-5 w-5" /> : <DocumentDuplicateIcon className="h-5 w-5" />}
                    </button>

                    <button
                        type="button"
                        onClick={handleEdit}
                        className="rounded-lg bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                        title={t('common.edit') || 'Edit'}
                        aria-label={t('common.edit') || 'Edit'}
                    >
                        <PencilIcon className="h-5 w-5" />
                    </button>

                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setShowMenu(!showMenu)}
                            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                            title={t('common.more') || 'More'}
                            aria-label={t('common.more') || 'More'}
                        >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowMenu(false);
                                        setTimeout(() => handleDelete(), 10);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                >
                                    <TrashIcon className="h-4 w-4" />
                                    {t('common.delete')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>
            <KeyboardCheatsheet open={isCheatsheetOpen} onClose={() => setIsCheatsheetOpen(false)} />
        </>
    );
}

export default function StudyNoteViewPage() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const params = useParams();
    const noteId = params.id as string;

    const { notes, deleteNote, loading: notesLoading, error: notesError } = useStudyNotes();
    const {
        draft: { title, content, tags, scriptureRefs, type, rootNode },
        setters: { setRootNode },
        meta: { isInitialized, existingNote, isNew, uid },
    } = useStudyNoteDraft(noteId);
    const {
        shareLinks,
        loading: shareLinksLoading,
        createShareLink,
        deleteShareLink,
    } = useStudyNoteShareLinks();
    const { isCopied, copyToClipboard } = useClipboard({ successDuration: 1500 });
    const wikilinkResolver = useWikilinkResolver();
    const searchParams = useSearchParams();
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);

    const bibleLocale: BibleLocale = useMemo(() => {
        const lang = i18n.language?.toLowerCase() || 'en';
        if (lang.startsWith('ru')) return 'ru';
        if (lang.startsWith('uk')) return 'uk';
        return 'en';
    }, [i18n.language]);

    const { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery } = useFilteredNotes(
        notes,
        noteId,
        searchParams,
        bibleLocale
    );

    useNoteKeyboardNavigation({ noteId, prevNoteId, nextNoteId, router, searchParams });
    useNoteAccessGuard({ noteId, isNew, notesLoading, error: notesError, existingNote, uid, redirectTo: '/studies' });

    const activeShareLink = useMemo(
        () => shareLinks.find((link) => link.noteId === noteId),
        [shareLinks, noteId]
    );

    const noteForShare = useMemo<StudyNote | null>(() => {
        if (!existingNote) return null;
        return {
            ...existingNote,
            title,
            content,
            tags,
            scriptureRefs,
            type,
            ...(rootNode ? { rootNode } : {}),
        };
    }, [content, existingNote, rootNode, scriptureRefs, tags, title, type]);

    const handleBack = useCallback(() => {
        router.push(withSearchParams('/studies', searchParams));
    }, [router, searchParams]);

    const handleEdit = useCallback(() => {
        router.push(withSearchParams(`/studies/${noteId}/edit`, searchParams));
    }, [noteId, router, searchParams]);

    const handleDelete = useNoteDeletion({ t, noteId, isNew, uid, deleteNote, router });

    const handleCopy = useCallback(() => {
        const copyRootNode = rootNode ?? existingNote?.rootNode ?? null;
        void copyToClipboard(
            formatStudyNoteForCopy({
                id: noteId,
                title,
                content,
                tags,
                scriptureRefs,
                type,
                userId: existingNote?.userId ?? uid ?? '',
                materialIds: existingNote?.materialIds ?? [],
                relatedSermonIds: existingNote?.relatedSermonIds ?? [],
                createdAt: existingNote?.createdAt ?? new Date().toISOString(),
                updatedAt: existingNote?.updatedAt ?? new Date().toISOString(),
                isDraft: existingNote?.isDraft ?? false,
                ...(copyRootNode ? { rootNode: copyRootNode } : {}),
            }, bibleLocale)
        );
    }, [bibleLocale, content, copyToClipboard, existingNote, noteId, rootNode, scriptureRefs, tags, title, type, uid]);

    if (notesLoading || (!isInitialized && !isNew)) {
        return (
            <div className="flex items-center justify-center p-12">
                <ArrowPathIcon className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
        );
    }

    const readRoot = rootNode ?? existingNote?.rootNode ?? null;

    return (
        <div className="relative -m-4 flex min-h-screen flex-col bg-white dark:bg-gray-900 md:-m-6 lg:-m-8">
            <StudyNoteViewHeader
                handleBack={handleBack}
                handleCopy={handleCopy}
                handleDelete={handleDelete}
                handleEdit={handleEdit}
                handleShare={() => setIsShareModalOpen(true)}
                isCopied={isCopied}
                hasShareLink={Boolean(activeShareLink)}
                t={t}
                filteredNotes={filteredNotes}
                prevNoteId={prevNoteId}
                nextNoteId={nextNoteId}
                router={router}
                searchParams={searchParams}
                currentIndex={currentIndex}
                type={type}
            />

            <div className="mx-auto w-full max-w-full flex-1 space-y-8 px-4 py-8 transition-all duration-300 md:px-12 md:py-16 md:pb-32">
                <div className="relative">
                    <h1 className="min-h-[1em] w-full text-4xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-50 md:text-5xl">
                        {title ? (
                            searchQuery ? <HighlightedText text={title} searchQuery={searchQuery} /> : title
                        ) : (
                            isNew ? '' : t('studiesWorkspace.untitled')
                        )}
                    </h1>
                </div>

                <div className="relative">
                    {readRoot ? (
                        <div className="text-lg leading-relaxed md:text-xl">
                            <NodeTreeEditor
                                rootNode={readRoot}
                                onChange={setRootNode}
                                currentNoteId={isNew ? undefined : noteId}
                                readOnly
                            />
                        </div>
                    ) : (
                        <div className="prose prose-emerald max-w-none text-lg dark:prose-invert prose-headings:text-gray-900 prose-p:leading-relaxed prose-p:text-gray-800 dark:prose-headings:text-gray-50 dark:prose-p:text-gray-200 md:text-xl">
                            <MarkdownDisplay
                                content={content}
                                searchQuery={searchQuery}
                                enableWikiLinks
                                wikilinkResolver={wikilinkResolver}
                            />
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-8 border-t border-gray-200 pt-8 dark:border-gray-700 md:grid-cols-2">
                    <div className="flex h-full flex-col space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.scriptureRefs')}>
                                <BookmarkIcon className="h-5 w-5" />
                                <span className="text-sm font-medium">{t('studiesWorkspace.scriptureRefs')}</span>
                            </div>
                        </div>

                        {scriptureRefs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {scriptureRefs.map((ref) => (
                                    <ScriptureRefBadge key={ref.id} reference={ref} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex h-full flex-col space-y-4">
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
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ShareNoteModal
                isOpen={isShareModalOpen}
                note={noteForShare}
                shareLink={activeShareLink}
                loading={shareLinksLoading}
                onClose={() => setIsShareModalOpen(false)}
                onCreate={createShareLink}
                onDelete={deleteShareLink}
            />
        </div>
    );
}
