'use client';

import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import {
    getStudyNoteOutlineBranchMaxHeadingLevel,
    remapStudyNoteOutlineKey,
    StudyNoteOutline,
    StudyNoteOutlineBranch,
} from './studyNoteOutline';

interface StudyNoteOutlineViewProps {
    outline: StudyNoteOutline;
    foldedBranchKeys: string[];
    onToggleBranch: (branchKey: string) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    onMoveBranch?: (branchKey: string, direction: 'up' | 'down') => void;
    onCreateBranch?: (branchKey: string, position: 'sibling' | 'child') => void;
    onShiftBranchDepth?: (branchKey: string, direction: 'promote' | 'demote') => void;
    searchQuery?: string;
    mode?: 'read' | 'preview';
    className?: string;
    testId?: string;
    preferredActiveBranchRequest?: { key: string; token: string } | null;
    showNavigator?: boolean;
}

const NAV_INDENT_PX = 14;
const BRANCH_INDENT_PX = 18;
const PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME =
    'inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200';
const PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME =
    ' disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-600 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300';

function hasBranchDetails(branch: StudyNoteOutlineBranch): boolean {
    return Boolean(branch.body.trim()) || branch.children.length > 0;
}

export function StudyNoteOutlineView({
    outline,
    foldedBranchKeys,
    onToggleBranch,
    onExpandAll,
    onCollapseAll,
    onMoveBranch,
    onCreateBranch,
    onShiftBranchDepth,
    searchQuery = '',
    mode = 'read',
    className = '',
    testId,
    preferredActiveBranchRequest = null,
    showNavigator = true,
}: StudyNoteOutlineViewProps) {
    const { t } = useTranslation();
    const isPreview = mode === 'preview';
    const foldedBranchKeySet = useMemo(() => new Set(foldedBranchKeys), [foldedBranchKeys]);
    const branchRefs = useRef<Record<string, HTMLElement | null>>({});
    const previousOutlineRef = useRef(outline);
    const [activeBranchKey, setActiveBranchKey] = useState<string | null>(outline.branches[0]?.key ?? null);

    useEffect(() => {
        setActiveBranchKey((currentKey) => {
            if (!currentKey) {
                return outline.branches[0]?.key ?? null;
            }

            const remappedKey = remapStudyNoteOutlineKey(
                currentKey,
                previousOutlineRef.current.branches,
                outline.branches
            );

            return remappedKey ?? outline.branches[0]?.key ?? null;
        });
        previousOutlineRef.current = outline;
    }, [outline]);

    useEffect(() => {
        if (!preferredActiveBranchRequest) {
            return;
        }

        const allBranchKeys = new Set(
            outline.branches.flatMap((branch) => collectBranchKeys(branch))
        );

        if (allBranchKeys.has(preferredActiveBranchRequest.key)) {
            setActiveBranchKey(preferredActiveBranchRequest.key);
        }
    }, [outline.branches, preferredActiveBranchRequest]);

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

    const renderBranch = (
        branch: StudyNoteOutlineBranch,
        siblingIndex: number,
        siblingCount: number
    ) => {
        const isFolded = foldedBranchKeySet.has(branch.key);
        const isCollapsible = hasBranchDetails(branch);
        const headingClassName = getHeadingClassName(branch.depth, isPreview);
        const canMoveUp = siblingIndex > 0;
        const canMoveDown = siblingIndex < siblingCount - 1;
        const canCreateChild = branch.headingLevel < 6;
        const canPromote = branch.path.length > 1;
        const canDemote = siblingIndex > 0 && getStudyNoteOutlineBranchMaxHeadingLevel(branch) < 6;
        const addSiblingLabel = t('studiesWorkspace.outlinePilot.addSibling');
        const addChildLabel = t('studiesWorkspace.outlinePilot.addChild');
        const promoteLabel = t('studiesWorkspace.outlinePilot.promoteBranch');
        const demoteLabel = t('studiesWorkspace.outlinePilot.demoteBranch');

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
                        <div className="space-y-2">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                            H{branch.headingLevel}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleJumpToBranch(branch.key)}
                                        className="w-full text-left"
                                    >
                                        <h3 className={`${headingClassName} transition-colors hover:text-emerald-700 dark:hover:text-emerald-400`}>
                                            {searchQuery.trim()
                                                ? <HighlightedText text={branch.title} searchQuery={searchQuery} />
                                                : branch.title}
                                        </h3>
                                    </button>
                                </div>
                                {isPreview && onMoveBranch && siblingCount > 1 && (
                                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                                        <button
                                            type="button"
                                            data-testid={`study-note-branch-move-up-${branch.key}`}
                                            aria-label={t('common.moveUp')}
                                            title={t('common.moveUp')}
                                            disabled={!canMoveUp}
                                            onClick={() => onMoveBranch(branch.key, 'up')}
                                            className="rounded-lg border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300"
                                        >
                                            <ArrowUpIcon className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            data-testid={`study-note-branch-move-down-${branch.key}`}
                                            aria-label={t('common.moveDown')}
                                            title={t('common.moveDown')}
                                            disabled={!canMoveDown}
                                            onClick={() => onMoveBranch(branch.key, 'down')}
                                            className="rounded-lg border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300"
                                        >
                                            <ArrowDownIcon className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            {isPreview && onCreateBranch && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        data-testid={`study-note-branch-create-sibling-${branch.key}`}
                                        aria-label={addSiblingLabel}
                                        title={addSiblingLabel}
                                        onClick={() => onCreateBranch(branch.key, 'sibling')}
                                        className={PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}
                                    >
                                        <PlusIcon className="h-3.5 w-3.5" />
                                        <span>{addSiblingLabel}</span>
                                    </button>
                                    <button
                                        type="button"
                                        data-testid={`study-note-branch-create-child-${branch.key}`}
                                        aria-label={addChildLabel}
                                        title={addChildLabel}
                                        disabled={!canCreateChild}
                                        onClick={() => onCreateBranch(branch.key, 'child')}
                                        className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                                    >
                                        <PlusIcon className="h-3.5 w-3.5" />
                                        <span>{addChildLabel}</span>
                                    </button>
                                    {onShiftBranchDepth && (
                                        <>
                                            <button
                                                type="button"
                                                data-testid={`study-note-branch-promote-${branch.key}`}
                                                aria-label={promoteLabel}
                                                title={promoteLabel}
                                                disabled={!canPromote}
                                                onClick={() => onShiftBranchDepth(branch.key, 'promote')}
                                                className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                                            >
                                                <ArrowLeftIcon className="h-3.5 w-3.5" />
                                                <span>{promoteLabel}</span>
                                            </button>
                                            <button
                                                type="button"
                                                data-testid={`study-note-branch-demote-${branch.key}`}
                                                aria-label={demoteLabel}
                                                title={demoteLabel}
                                                disabled={!canDemote}
                                                onClick={() => onShiftBranchDepth(branch.key, 'demote')}
                                                className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                                            >
                                                <ArrowRightIcon className="h-3.5 w-3.5" />
                                                <span>{demoteLabel}</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

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
                                        {branch.children.map((childBranch, childIndex) =>
                                            renderBranch(childBranch, childIndex, branch.children.length)
                                        )}
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

                <div className={`grid gap-6 ${showNavigator && outline.branches.length > 1 ? 'xl:grid-cols-[240px_minmax(0,1fr)]' : ''}`}>
                    {showNavigator && outline.branches.length > 1 && (
                        <nav className="hidden xl:block">
                            <div className="sticky top-24 rounded-2xl border border-gray-200/80 bg-white/80 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/70">
                                <ul className="space-y-1.5">
                                    {outline.branches.map(renderNavigator)}
                                </ul>
                            </div>
                        </nav>
                    )}

                    <div className="space-y-3">
                        {outline.branches.map((branch, index) =>
                            renderBranch(branch, index, outline.branches.length)
                        )}
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
