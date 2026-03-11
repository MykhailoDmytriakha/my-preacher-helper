'use client';

import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { StudyNoteOutline, StudyNoteOutlineBranch } from './studyNoteOutline';

interface StudyNoteOutlineViewProps {
    outline: StudyNoteOutline;
    foldedBranchKeys: string[];
    onToggleBranch: (branchKey: string) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    searchQuery?: string;
    mode?: 'read' | 'preview';
    className?: string;
    testId?: string;
}

const NAV_INDENT_PX = 14;
const BRANCH_INDENT_PX = 18;

function hasBranchDetails(branch: StudyNoteOutlineBranch): boolean {
    return Boolean(branch.body.trim()) || branch.children.length > 0;
}

export function StudyNoteOutlineView({
    outline,
    foldedBranchKeys,
    onToggleBranch,
    onExpandAll,
    onCollapseAll,
    searchQuery = '',
    mode = 'read',
    className = '',
    testId,
}: StudyNoteOutlineViewProps) {
    const { t } = useTranslation();
    const isPreview = mode === 'preview';
    const foldedBranchKeySet = useMemo(() => new Set(foldedBranchKeys), [foldedBranchKeys]);
    const branchRefs = useRef<Record<string, HTMLElement | null>>({});
    const [activeBranchKey, setActiveBranchKey] = useState<string | null>(outline.branches[0]?.key ?? null);

    useEffect(() => {
        const allBranchKeys = new Set(
            outline.branches.flatMap((branch) => collectBranchKeys(branch))
        );

        setActiveBranchKey((currentKey) => {
            if (currentKey && allBranchKeys.has(currentKey)) {
                return currentKey;
            }

            return outline.branches[0]?.key ?? null;
        });
    }, [outline.branches]);

    const handleJumpToBranch = (branchKey: string) => {
        setActiveBranchKey(branchKey);

        requestAnimationFrame(() => {
            branchRefs.current[branchKey]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        });
    };

    const renderNavigator = (branch: StudyNoteOutlineBranch) => {
        const isFolded = foldedBranchKeySet.has(branch.key);
        const isActive = activeBranchKey === branch.key;
        const isCollapsible = hasBranchDetails(branch);

        return (
            <li key={`nav-${branch.key}`} className="space-y-1">
                <button
                    type="button"
                    onClick={() => handleJumpToBranch(branch.key)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                        isActive
                            ? 'bg-emerald-100/80 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/80'
                    }`}
                    style={{ paddingLeft: `${12 + branch.depth * NAV_INDENT_PX}px` }}
                >
                    {isCollapsible ? (
                        isFolded ? (
                            <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        ) : (
                            <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        )
                    ) : (
                        <span className="ml-1 h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                    )}
                    <span className="min-w-0 truncate">
                        {searchQuery.trim()
                            ? <HighlightedText text={branch.title} searchQuery={searchQuery} />
                            : branch.title}
                    </span>
                </button>

                {!isFolded && branch.children.length > 0 && (
                    <ul className="space-y-1">
                        {branch.children.map(renderNavigator)}
                    </ul>
                )}
            </li>
        );
    };

    const renderBranch = (branch: StudyNoteOutlineBranch) => {
        const isFolded = foldedBranchKeySet.has(branch.key);
        const isCollapsible = hasBranchDetails(branch);
        const headingClassName = getHeadingClassName(branch.depth, isPreview);

        return (
            <section
                key={branch.key}
                ref={(element) => {
                    branchRefs.current[branch.key] = element;
                }}
                data-testid={`study-note-branch-${branch.key}`}
                className={`rounded-2xl border border-gray-200/80 bg-white/90 shadow-sm transition-colors dark:border-gray-700 dark:bg-gray-900/70 ${
                    activeBranchKey === branch.key
                        ? 'ring-2 ring-emerald-200 dark:ring-emerald-700/60'
                        : ''
                }`}
                style={{ marginLeft: `${branch.depth * BRANCH_INDENT_PX}px` }}
            >
                <div className="flex items-start gap-3 px-4 py-4">
                    {isCollapsible ? (
                        <button
                            type="button"
                            onClick={() => onToggleBranch(branch.key)}
                            data-testid={`study-note-branch-toggle-${branch.key}`}
                            aria-label={isFolded ? t('common.expand') : t('common.collapse')}
                            title={isFolded ? t('common.expand') : t('common.collapse')}
                            className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                        >
                            {isFolded ? (
                                <ChevronRightIcon className="h-4 w-4" />
                            ) : (
                                <ChevronDownIcon className="h-4 w-4" />
                            )}
                        </button>
                    ) : (
                        <span className="mt-2 h-2.5 w-2.5 rounded-full bg-emerald-400/80 dark:bg-emerald-500/80" />
                    )}

                    <div className="min-w-0 flex-1 space-y-3">
                        <button
                            type="button"
                            onClick={() => handleJumpToBranch(branch.key)}
                            className="w-full text-left"
                        >
                            <div className="mb-1 flex items-center gap-2">
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                    H{branch.headingLevel}
                                </span>
                            </div>
                            <h3 className={headingClassName}>
                                {searchQuery.trim()
                                    ? <HighlightedText text={branch.title} searchQuery={searchQuery} />
                                    : branch.title}
                            </h3>
                        </button>

                        {isFolded ? (
                            branch.preview ? (
                                <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                                    {searchQuery.trim()
                                        ? <HighlightedText text={branch.preview} searchQuery={searchQuery} />
                                        : branch.preview}
                                </p>
                            ) : null
                        ) : (
                            <>
                                {branch.body.trim() && (
                                    <MarkdownDisplay
                                        content={branch.body}
                                        compact={isPreview}
                                        searchQuery={searchQuery}
                                        className={isPreview
                                            ? '!text-sm prose-p:my-2 prose-headings:my-2'
                                            : 'prose-p:my-2 prose-headings:my-3'
                                        }
                                    />
                                )}

                                {branch.children.length > 0 && (
                                    <div className="space-y-3">
                                        {branch.children.map(renderBranch)}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </section>
        );
    };

    return (
        <div
            data-testid={testId}
            className={`not-prose rounded-[28px] border border-gray-200/80 bg-gradient-to-b from-white to-gray-50/90 shadow-sm dark:border-gray-700 dark:from-gray-900 dark:to-gray-950 ${className}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/70 px-5 py-4 dark:border-gray-700">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
                        {isPreview
                            ? t('studiesWorkspace.outlinePilot.previewTitle')
                            : t('studiesWorkspace.outlinePilot.structuredTitle')}
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {t('studiesWorkspace.outlinePilot.branchCount', { count: outline.totalBranches })}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onExpandAll}
                        className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                    >
                        {t('studiesWorkspace.expandAll')}
                    </button>
                    <button
                        type="button"
                        onClick={onCollapseAll}
                        className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                    >
                        {t('studiesWorkspace.collapseAll')}
                    </button>
                </div>
            </div>

            <div className="space-y-6 px-5 py-5">
                {outline.introduction.trim() && (
                    <section className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-4 py-4 dark:border-gray-700 dark:bg-gray-900/60">
                        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                            {t('studiesWorkspace.outlinePilot.openingContent')}
                        </div>
                        <MarkdownDisplay
                            content={outline.introduction}
                            compact={isPreview}
                            searchQuery={searchQuery}
                            className={isPreview ? '!text-sm prose-p:my-2 prose-headings:my-2' : 'prose-p:my-2 prose-headings:my-3'}
                        />
                    </section>
                )}

                <div className={`grid gap-6 ${outline.branches.length > 1 ? 'xl:grid-cols-[240px_minmax(0,1fr)]' : ''}`}>
                    {outline.branches.length > 1 && (
                        <nav className="hidden xl:block">
                            <div className="sticky top-24 rounded-2xl border border-gray-200/80 bg-white/80 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/70">
                                <ul className="space-y-1.5">
                                    {outline.branches.map(renderNavigator)}
                                </ul>
                            </div>
                        </nav>
                    )}

                    <div className="space-y-3">
                        {outline.branches.map(renderBranch)}
                    </div>
                </div>
            </div>
        </div>
    );
}

function collectBranchKeys(branch: StudyNoteOutlineBranch): string[] {
    return [branch.key, ...branch.children.flatMap(collectBranchKeys)];
}

function getHeadingClassName(depth: number, isPreview: boolean): string {
    if (depth <= 0) {
        return isPreview
            ? 'text-xl font-semibold leading-tight text-gray-900 dark:text-gray-50'
            : 'text-2xl font-semibold leading-tight text-gray-900 dark:text-gray-50';
    }

    if (depth === 1) {
        return isPreview
            ? 'text-lg font-semibold leading-tight text-gray-900 dark:text-gray-100'
            : 'text-xl font-semibold leading-tight text-gray-900 dark:text-gray-100';
    }

    return isPreview
        ? 'text-base font-semibold leading-snug text-gray-900 dark:text-gray-100'
        : 'text-lg font-semibold leading-snug text-gray-900 dark:text-gray-100';
}
