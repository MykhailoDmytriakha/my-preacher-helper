'use client';

import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, DocumentDuplicateIcon, LinkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { buildStudyNoteBranchBacklinks } from './studyNoteBranchBacklinks';
import {
    getStudyNoteOutlineBranchMaxHeadingLevel,
    remapStudyNoteOutlineKey,
    StudyNoteOutline,
    StudyNoteOutlineBranch,
} from './studyNoteOutline';

import type { StudyNoteBranchOverlayTone } from '@/models/models';

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
    onCopyBranchLink?: (branchKey: string) => void;
    onCopyBranchReference?: (branchKey: string, relationLabel?: string) => void;
    onBranchLinkClick?: (branchId: string) => void;
    onInsertBranchReference?: (branchKey: string, relationLabel?: string) => void;
    onSetBranchOverlayTone?: (branchKey: string, overlayTone: StudyNoteBranchOverlayTone | null) => void;
}

const NAV_INDENT_PX = 14;
const BRANCH_INDENT_PX = 18;
const PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME =
    'inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200';
const PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME =
    ' disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-600 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300';
const BRANCH_OVERLAY_TONES: StudyNoteBranchOverlayTone[] = ['amber', 'emerald', 'sky', 'rose', 'violet', 'slate'];

function hasBranchDetails(branch: StudyNoteOutlineBranch): boolean {
    return Boolean(branch.body.trim()) || branch.children.length > 0;
}

function getBranchOverlayCardClassName(overlayTone?: StudyNoteBranchOverlayTone | null): string {
    switch (overlayTone) {
        case 'amber':
            return 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-900/10';
        case 'emerald':
            return 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-900/10';
        case 'sky':
            return 'border-sky-200/80 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-900/10';
        case 'rose':
            return 'border-rose-200/80 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-900/10';
        case 'violet':
            return 'border-violet-200/80 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-900/10';
        case 'slate':
            return 'border-slate-300/80 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/50';
        default:
            return 'border-gray-200/80 bg-white/90 dark:border-gray-700 dark:bg-gray-900/70';
    }
}

function getBranchOverlaySwatchClassName(overlayTone?: StudyNoteBranchOverlayTone | null): string {
    switch (overlayTone) {
        case 'amber':
            return 'bg-amber-400 dark:bg-amber-500';
        case 'emerald':
            return 'bg-emerald-400 dark:bg-emerald-500';
        case 'sky':
            return 'bg-sky-400 dark:bg-sky-500';
        case 'rose':
            return 'bg-rose-400 dark:bg-rose-500';
        case 'violet':
            return 'bg-violet-400 dark:bg-violet-500';
        case 'slate':
            return 'bg-slate-500 dark:bg-slate-400';
        default:
            return 'bg-gray-300 dark:bg-gray-600';
    }
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
    onCopyBranchLink,
    onCopyBranchReference,
    onBranchLinkClick,
    onInsertBranchReference,
    onSetBranchOverlayTone,
}: StudyNoteOutlineViewProps) {
    const { t } = useTranslation();
    const isPreview = mode === 'preview';
    const foldedBranchKeySet = useMemo(() => new Set(foldedBranchKeys), [foldedBranchKeys]);
    const branchRefs = useRef<Record<string, HTMLElement | null>>({});
    const previousOutlineRef = useRef(outline);
    const [activeBranchKey, setActiveBranchKey] = useState<string | null>(outline.branches[0]?.key ?? null);
    const [referenceRelationByBranchKey, setReferenceRelationByBranchKey] = useState<Record<string, string>>({});
    const relationOptions = useMemo(() => ([
        { value: '', label: t('studiesWorkspace.outlinePilot.branchRelations.plain') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.supports'), label: t('studiesWorkspace.outlinePilot.branchRelations.supports') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.contrasts'), label: t('studiesWorkspace.outlinePilot.branchRelations.contrasts') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.expands'), label: t('studiesWorkspace.outlinePilot.branchRelations.expands') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.applies'), label: t('studiesWorkspace.outlinePilot.branchRelations.applies') },
    ]), [t]);
    const backlinksByTargetId = useMemo(
        () => buildStudyNoteBranchBacklinks(outline.branches),
        [outline.branches]
    );

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
        const insertReferenceLabel = t('studiesWorkspace.outlinePilot.insertBranchReference');
        const selectedReferenceRelation = referenceRelationByBranchKey[branch.key] ?? '';
        const branchBacklinks = branch.branchId ? backlinksByTargetId[branch.branchId] ?? [] : [];

        return (
            <section
                key={branch.key}
                ref={(element) => {
                    branchRefs.current[branch.key] = element;
                }}
                id={branch.branchId ? `branch-${branch.branchId}` : undefined}
                data-testid={`study-note-branch-${branch.key}`}
                className={`rounded-2xl border shadow-sm transition-colors ${getBranchOverlayCardClassName(branch.overlayTone)} ${
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
                                        {branch.overlayTone && (
                                            <span
                                                data-testid={`study-note-branch-overlay-indicator-${branch.key}`}
                                                className={`h-2.5 w-2.5 rounded-full ${getBranchOverlaySwatchClassName(branch.overlayTone)}`}
                                            />
                                        )}
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                            H{branch.headingLevel}
                                        </span>
                                        {onCopyBranchLink && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    data-testid={`study-note-branch-copy-link-${branch.key}`}
                                                    aria-label={t('studiesWorkspace.shareLinks.copyLink')}
                                                    title={t('studiesWorkspace.shareLinks.copyLink')}
                                                    onClick={() => onCopyBranchLink(branch.key)}
                                                    className="rounded-full border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                                                >
                                                    <LinkIcon className="h-3.5 w-3.5" />
                                                </button>
                                                {onCopyBranchReference && (
                                                    <button
                                                        type="button"
                                                        data-testid={`study-note-branch-copy-reference-${branch.key}`}
                                                        aria-label={t('studiesWorkspace.outlinePilot.copyBranchReference')}
                                                        title={t('studiesWorkspace.outlinePilot.copyBranchReference')}
                                                        onClick={() => onCopyBranchReference(branch.key)}
                                                        className="rounded-full border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                                                    >
                                                        <DocumentDuplicateIcon className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
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
                                    {onInsertBranchReference && (
                                        <>
                                            <label className="sr-only" htmlFor={`study-note-branch-relation-${branch.key}`}>
                                                {t('studiesWorkspace.outlinePilot.referenceRelation')}
                                            </label>
                                            <select
                                                id={`study-note-branch-relation-${branch.key}`}
                                                data-testid={`study-note-branch-relation-${branch.key}`}
                                                value={selectedReferenceRelation}
                                                onChange={(event) => {
                                                    const nextValue = event.target.value;
                                                    setReferenceRelationByBranchKey((currentValue) => ({
                                                        ...currentValue,
                                                        [branch.key]: nextValue,
                                                    }));
                                                }}
                                                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:text-emerald-200"
                                            >
                                                {relationOptions.map((relationOption) => (
                                                    <option key={`${branch.key}-${relationOption.label}`} value={relationOption.value}>
                                                        {relationOption.label}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                data-testid={`study-note-branch-insert-reference-${branch.key}`}
                                                aria-label={insertReferenceLabel}
                                                title={insertReferenceLabel}
                                                onClick={() => onInsertBranchReference(
                                                    branch.key,
                                                    selectedReferenceRelation || undefined
                                                )}
                                                className={PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}
                                            >
                                                <LinkIcon className="h-3.5 w-3.5" />
                                                <span>{insertReferenceLabel}</span>
                                            </button>
                                        </>
                                    )}
                                    {onSetBranchOverlayTone && (
                                        <div className="flex items-center gap-1">
                                            <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                                                {t('studiesWorkspace.outlinePilot.branchColor')}
                                            </span>
                                            <button
                                                type="button"
                                                data-testid={`study-note-branch-overlay-clear-${branch.key}`}
                                                aria-label={t('studiesWorkspace.outlinePilot.clearBranchColor')}
                                                title={t('studiesWorkspace.outlinePilot.clearBranchColor')}
                                                onClick={() => onSetBranchOverlayTone(branch.key, null)}
                                                className={`inline-flex h-7 items-center rounded-full border px-2 text-[11px] font-medium transition-colors ${
                                                    branch.overlayTone
                                                        ? 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:text-emerald-200'
                                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                                                }`}
                                            >
                                                {t('common.clear')}
                                            </button>
                                            {BRANCH_OVERLAY_TONES.map((overlayTone) => (
                                                <button
                                                    key={`${branch.key}-${overlayTone}`}
                                                    type="button"
                                                    data-testid={`study-note-branch-overlay-${branch.key}-${overlayTone}`}
                                                    aria-label={t(`studiesWorkspace.outlinePilot.branchOverlayTones.${overlayTone}`)}
                                                    title={t(`studiesWorkspace.outlinePilot.branchOverlayTones.${overlayTone}`)}
                                                    onClick={() => onSetBranchOverlayTone(branch.key, overlayTone)}
                                                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-transform hover:scale-105 ${
                                                        branch.overlayTone === overlayTone
                                                            ? 'border-emerald-500 ring-2 ring-emerald-200 dark:border-emerald-400 dark:ring-emerald-700/60'
                                                            : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                >
                                                    <span className={`h-3.5 w-3.5 rounded-full ${getBranchOverlaySwatchClassName(overlayTone)}`} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
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
                                {branchBacklinks.length > 0 && (
                                    <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-3 dark:border-emerald-900/60 dark:bg-emerald-900/20">
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                                            {t('studiesWorkspace.outlinePilot.referencedBy')}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {branchBacklinks.map((backlink) => (
                                                <button
                                                    key={`${branch.key}-${backlink.sourceBranchKey}-${backlink.referenceLabel}-${backlink.relationLabel ?? 'plain'}`}
                                                    type="button"
                                                    data-testid={`study-note-branch-backlink-${branch.key}-${backlink.sourceBranchKey}`}
                                                    onClick={() => handleJumpToBranch(backlink.sourceBranchKey)}
                                                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-gray-900 dark:text-emerald-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/40"
                                                >
                                                    <span>{backlink.sourceBranchTitle}</span>
                                                    {backlink.relationLabel && (
                                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-900/30 dark:text-emerald-200">
                                                            {backlink.relationLabel}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {branch.body.trim() && (
                                    <MarkdownDisplay
                                        content={branch.body}
                                        compact={isPreview}
                                        searchQuery={searchQuery}
                                        onBranchLinkClick={onBranchLinkClick}
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
                            onBranchLinkClick={onBranchLinkClick}
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
