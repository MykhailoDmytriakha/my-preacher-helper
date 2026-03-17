'use client';

import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, DocumentDuplicateIcon, LinkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getStudyNoteBranchRelationTranslationKey } from '@/utils/studyNoteBranchLinks';
import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { buildStudyNoteBranchBacklinks, type StudyNoteBranchBacklink } from './studyNoteBranchBacklinks';
import {
    normalizeStudyNoteBranchKind,
    normalizeStudyNoteBranchSemanticLabel,
    normalizeStudyNoteBranchStatus,
    STUDY_NOTE_BRANCH_KIND_VALUES,
    STUDY_NOTE_BRANCH_STATUS_VALUES,
} from './studyNoteBranchIdentity';
import {
    flattenStudyNoteOutlineBranches,
    getStudyNoteOutlineBranchMaxHeadingLevel,
    remapStudyNoteOutlineKey,
    StudyNoteOutline,
    StudyNoteOutlineBranch,
} from './studyNoteOutline';

import type {
    StudyNoteBranchKind,
    StudyNoteBranchOverlayTone,
    StudyNoteBranchStatus,
} from '@/models/models';

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
    onSetBranchSemanticLabel?: (branchKey: string, semanticLabel: string | null) => void;
    onSetBranchKind?: (branchKey: string, branchKind: StudyNoteBranchKind | null) => void;
    onSetBranchStatus?: (branchKey: string, branchStatus: StudyNoteBranchStatus | null) => void;
}

const NAV_INDENT_PX = 14;
const BRANCH_INDENT_PX = 18;
const PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME =
    'inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200';
const PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME =
    ' disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-600 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300';
const BRANCH_OVERLAY_TONES: StudyNoteBranchOverlayTone[] = ['amber', 'emerald', 'sky', 'rose', 'violet', 'slate'];

type BranchMetadataFilterValue<T extends string> = 'all' | T;

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

function getBranchKindBadgeClassName(branchKind?: StudyNoteBranchKind | null): string {
    switch (branchKind) {
        case 'summary':
            return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-900/25 dark:text-sky-200';
        case 'insight':
            return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-900/25 dark:text-violet-200';
        case 'evidence':
            return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/25 dark:text-amber-200';
        case 'question':
            return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/25 dark:text-rose-200';
        case 'application':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/25 dark:text-emerald-200';
        default:
            return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
}

function getBranchStatusBadgeClassName(branchStatus?: StudyNoteBranchStatus | null): string {
    switch (branchStatus) {
        case 'active':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/25 dark:text-emerald-200';
        case 'tentative':
            return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/25 dark:text-amber-200';
        case 'confirmed':
            return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-900/25 dark:text-sky-200';
        case 'resolved':
            return 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
        default:
            return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
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
    onSetBranchSemanticLabel,
    onSetBranchKind,
    onSetBranchStatus,
}: StudyNoteOutlineViewProps) {
    const { t } = useTranslation();
    const isPreview = mode === 'preview';
    const foldedBranchKeySet = useMemo(() => new Set(foldedBranchKeys), [foldedBranchKeys]);
    const branchRefs = useRef<Record<string, HTMLElement | null>>({});
    const previousOutlineRef = useRef(outline);
    const [activeBranchKey, setActiveBranchKey] = useState<string | null>(outline.branches[0]?.key ?? null);
    const [referenceRelationByBranchKey, setReferenceRelationByBranchKey] = useState<Record<string, string>>({});
    const [semanticLabelDraftByBranchKey, setSemanticLabelDraftByBranchKey] = useState<Record<string, string>>({});
    const [kindFilter, setKindFilter] = useState<BranchMetadataFilterValue<StudyNoteBranchKind>>('all');
    const [statusFilter, setStatusFilter] = useState<BranchMetadataFilterValue<StudyNoteBranchStatus>>('all');
    const relationOptions = useMemo(() => ([
        { value: '', label: t('studiesWorkspace.outlinePilot.branchRelations.plain') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.supports'), label: t('studiesWorkspace.outlinePilot.branchRelations.supports') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.contrasts'), label: t('studiesWorkspace.outlinePilot.branchRelations.contrasts') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.expands'), label: t('studiesWorkspace.outlinePilot.branchRelations.expands') },
        { value: t('studiesWorkspace.outlinePilot.branchRelations.applies'), label: t('studiesWorkspace.outlinePilot.branchRelations.applies') },
    ]), [t]);
    const branchKindOptions = useMemo(() => ([
        { value: 'all' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.all') },
        ...STUDY_NOTE_BRANCH_KIND_VALUES.map((value) => ({
            value,
            label: t(`studiesWorkspace.outlinePilot.branchKinds.${value}`),
        })),
    ]), [t]);
    const branchStatusOptions = useMemo(() => ([
        { value: 'all' as const, label: t('studiesWorkspace.outlinePilot.branchStatuses.all') },
        ...STUDY_NOTE_BRANCH_STATUS_VALUES.map((value) => ({
            value,
            label: t(`studiesWorkspace.outlinePilot.branchStatuses.${value}`),
        })),
    ]), [t]);
    const backlinksByTargetId = useMemo(
        () => buildStudyNoteBranchBacklinks(outline.branches),
        [outline.branches]
    );
    const flattenedBranches = useMemo(
        () => flattenStudyNoteOutlineBranches(outline.branches),
        [outline.branches]
    );
    const kindCounts = useMemo(
        () => buildBranchMetadataCountMap(flattenedBranches, 'branchKind'),
        [flattenedBranches]
    );
    const statusCounts = useMemo(
        () => buildBranchMetadataCountMap(flattenedBranches, 'branchStatus'),
        [flattenedBranches]
    );
    const filteredBranches = useMemo(
        () => filterStudyNoteOutlineBranchesByMetadata(outline.branches, { kindFilter, statusFilter }),
        [kindFilter, outline.branches, statusFilter]
    );
    const filteredBranchCount = useMemo(
        () => flattenStudyNoteOutlineBranches(filteredBranches).length,
        [filteredBranches]
    );
    const visibleBranchKeySet = useMemo(
        () => new Set(flattenStudyNoteOutlineBranches(filteredBranches).map((branch) => branch.key)),
        [filteredBranches]
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
        setActiveBranchKey((currentKey) => {
            if (currentKey && visibleBranchKeySet.has(currentKey)) {
                return currentKey;
            }

            const fallbackKey = filteredBranches[0]?.key ?? null;
            return fallbackKey;
        });
    }, [filteredBranches, visibleBranchKeySet]);

    useEffect(() => {
        if (!preferredActiveBranchRequest) {
            return;
        }

        const allBranchKeys = new Set(outline.branches.flatMap((branch) => collectBranchKeys(branch)));

        if (allBranchKeys.has(preferredActiveBranchRequest.key)) {
            setKindFilter('all');
            setStatusFilter('all');
            setActiveBranchKey(preferredActiveBranchRequest.key);
        }
    }, [outline.branches, preferredActiveBranchRequest]);

    const handleJumpToBranch = (branchKey: string) => {
        if (!visibleBranchKeySet.has(branchKey)) {
            setKindFilter('all');
            setStatusFilter('all');
        }
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
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${isActive
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

    const renderBranchKindStatusSelects = (branch: StudyNoteOutlineBranch) => (
        <div className="flex flex-wrap items-center gap-2">
            {onSetBranchKind && (
                <>
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        {t('studiesWorkspace.outlinePilot.branchKind')}
                    </span>
                    <select
                        data-testid={`study-note-branch-kind-select-${branch.key}`}
                        value={branch.branchKind ?? ''}
                        onChange={(event) => {
                            onSetBranchKind(
                                branch.key,
                                normalizeStudyNoteBranchKind(event.target.value)
                            );
                        }}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-emerald-200 focus:border-emerald-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-emerald-700 dark:focus:border-emerald-500"
                    >
                        <option value="">
                            {t('studiesWorkspace.outlinePilot.branchKinds.none')}
                        </option>
                        {STUDY_NOTE_BRANCH_KIND_VALUES.map((branchKindValue) => (
                            <option key={`${branch.key}-kind-${branchKindValue}`} value={branchKindValue}>
                                {t(`studiesWorkspace.outlinePilot.branchKinds.${branchKindValue}`)}
                            </option>
                        ))}
                    </select>
                </>
            )}
            {onSetBranchStatus && (
                <>
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        {t('studiesWorkspace.outlinePilot.branchStatus')}
                    </span>
                    <select
                        data-testid={`study-note-branch-status-select-${branch.key}`}
                        value={branch.branchStatus ?? ''}
                        onChange={(event) => {
                            onSetBranchStatus(
                                branch.key,
                                normalizeStudyNoteBranchStatus(event.target.value)
                            );
                        }}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-emerald-200 focus:border-emerald-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-emerald-700 dark:focus:border-emerald-500"
                    >
                        <option value="">
                            {t('studiesWorkspace.outlinePilot.branchStatuses.none')}
                        </option>
                        {STUDY_NOTE_BRANCH_STATUS_VALUES.map((branchStatusValue) => (
                            <option key={`${branch.key}-status-${branchStatusValue}`} value={branchStatusValue}>
                                {t(`studiesWorkspace.outlinePilot.branchStatuses.${branchStatusValue}`)}
                            </option>
                        ))}
                    </select>
                </>
            )}
        </div>
    );

    const renderBranchPreviewActions = (
        branch: StudyNoteOutlineBranch,
        siblingIndex: number,
        semanticLabelDraft: string,
        normalizedSemanticLabelDraft: string | null,
        selectedReferenceRelation: string
    ) => {
        const addSiblingLabel = t('studiesWorkspace.outlinePilot.addSibling');
        const addChildLabel = t('studiesWorkspace.outlinePilot.addChild');
        const insertReferenceLabel = t('studiesWorkspace.outlinePilot.insertBranchReference');
        const promoteBranchLabel = t('studiesWorkspace.outlinePilot.promoteBranch');
        const demoteBranchLabel = t('studiesWorkspace.outlinePilot.demoteBranch');
        const saveLabel = t('common.save');
        return (
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    data-testid={`study-note-branch-create-sibling-${branch.key}`}
                    aria-label={addSiblingLabel}
                    title={addSiblingLabel}
                    onClick={() => onCreateBranch!(branch.key, 'sibling')}
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
                    disabled={branch.headingLevel >= 6}
                    onClick={() => onCreateBranch!(branch.key, 'child')}
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
                            className={`inline-flex h-7 items-center rounded-full border px-2 text-[11px] font-medium transition-colors ${branch.overlayTone
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
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-transform hover:scale-105 ${branch.overlayTone === overlayTone
                                        ? 'border-emerald-500 ring-2 ring-emerald-200 dark:border-emerald-400 dark:ring-emerald-700/60'
                                        : 'border-gray-200 dark:border-gray-700'
                                    }`}
                            >
                                <span className={`h-3.5 w-3.5 rounded-full ${getBranchOverlaySwatchClassName(overlayTone)}`} />
                            </button>
                        ))}
                    </div>
                )}
                {onSetBranchSemanticLabel && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                            {t('studiesWorkspace.outlinePilot.branchSemanticLabel')}
                        </span>
                        <label className="sr-only" htmlFor={`study-note-branch-semantic-label-input-${branch.key}`}>
                            {t('studiesWorkspace.outlinePilot.branchSemanticLabel')}
                        </label>
                        <input
                            id={`study-note-branch-semantic-label-input-${branch.key}`}
                            data-testid={`study-note-branch-semantic-label-input-${branch.key}`}
                            type="text"
                            maxLength={48}
                            value={semanticLabelDraft}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                setSemanticLabelDraftByBranchKey((currentValue) => ({
                                    ...currentValue,
                                    [branch.key]: nextValue,
                                }));
                            }}
                            placeholder={t('studiesWorkspace.outlinePilot.branchSemanticLabelPlaceholder')}
                            className="min-w-[9rem] rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-emerald-200 focus:border-emerald-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-emerald-700 dark:focus:border-emerald-500"
                        />
                        <button
                            type="button"
                            data-testid={`study-note-branch-semantic-label-save-${branch.key}`}
                            aria-label={saveLabel}
                            title={saveLabel}
                            disabled={normalizedSemanticLabelDraft === normalizeStudyNoteBranchSemanticLabel(branch.semanticLabel)}
                            onClick={() => onSetBranchSemanticLabel(branch.key, semanticLabelDraft)}
                            className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                        >
                            <span>{saveLabel}</span>
                        </button>
                        <button
                            type="button"
                            data-testid={`study-note-branch-semantic-label-clear-${branch.key}`}
                            aria-label={t('studiesWorkspace.outlinePilot.clearBranchSemanticLabel')}
                            title={t('studiesWorkspace.outlinePilot.clearBranchSemanticLabel')}
                            onClick={() => {
                                setSemanticLabelDraftByBranchKey((currentValue) => ({
                                    ...currentValue,
                                    [branch.key]: '',
                                }));
                                onSetBranchSemanticLabel(branch.key, null);
                            }}
                            className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                            disabled={!branch.semanticLabel && normalizedSemanticLabelDraft === null}
                        >
                            <span>{t('common.clear')}</span>
                        </button>
                    </div>
                )}
                {(onSetBranchKind || onSetBranchStatus) && renderBranchKindStatusSelects(branch)}
                {onShiftBranchDepth && (
                    <>
                        <button
                            type="button"
                            data-testid={`study-note-branch-promote-${branch.key}`}
                            aria-label={promoteBranchLabel}
                            title={promoteBranchLabel}
                            disabled={branch.path.length <= 1}
                            onClick={() => onShiftBranchDepth(branch.key, 'promote')}
                            className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                        >
                            <ArrowLeftIcon className="h-3.5 w-3.5" />
                            <span>{promoteBranchLabel}</span>
                        </button>
                        <button
                            type="button"
                            data-testid={`study-note-branch-demote-${branch.key}`}
                            aria-label={demoteBranchLabel}
                            title={demoteBranchLabel}
                            disabled={!(siblingIndex > 0 && getStudyNoteOutlineBranchMaxHeadingLevel(branch) < 6)}
                            onClick={() => onShiftBranchDepth(branch.key, 'demote')}
                            className={`${PREVIEW_BRANCH_ACTION_BUTTON_CLASS_NAME}${PREVIEW_BRANCH_ACTION_BUTTON_DISABLED_CLASS_NAME}`}
                        >
                            <ArrowRightIcon className="h-3.5 w-3.5" />
                            <span>{demoteBranchLabel}</span>
                        </button>
                    </>
                )}
            </div>
        );
    };

    const renderBranchBadgeRow = (
        branch: StudyNoteOutlineBranch,
        branchKindLabel: string | null,
        branchStatusLabel: string | null
    ) => (
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
            {branch.branchKind && branchKindLabel && (
                <span
                    data-testid={`study-note-branch-kind-${branch.key}`}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${getBranchKindBadgeClassName(branch.branchKind)}`}
                >
                    {branchKindLabel}
                </span>
            )}
            {branch.branchStatus && branchStatusLabel && (
                <span
                    data-testid={`study-note-branch-status-${branch.key}`}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${getBranchStatusBadgeClassName(branch.branchStatus)}`}
                >
                    {branchStatusLabel}
                </span>
            )}
            {branch.semanticLabel && (
                <span
                    data-testid={`study-note-branch-semantic-label-${branch.key}`}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-900/30 dark:text-emerald-200"
                >
                    {branch.semanticLabel}
                </span>
            )}
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
    );

    const renderBranchMoveControls = (
        branch: StudyNoteOutlineBranch,
        canMoveUp: boolean,
        canMoveDown: boolean
    ) => (
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
            <button
                type="button"
                data-testid={`study-note-branch-move-up-${branch.key}`}
                aria-label={t('common.moveUp')}
                title={t('common.moveUp')}
                disabled={!canMoveUp}
                onClick={() => onMoveBranch!(branch.key, 'up')}
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
                onClick={() => onMoveBranch!(branch.key, 'down')}
                className="rounded-lg border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200 dark:disabled:hover:border-gray-700 dark:disabled:hover:bg-gray-900 dark:disabled:hover:text-gray-300"
            >
                <ArrowDownIcon className="h-4 w-4" />
            </button>
        </div>
    );

    const renderBranchContent = (
        branch: StudyNoteOutlineBranch,
        isFolded: boolean,
        branchBacklinks: StudyNoteBranchBacklink[]
    ) => {
        if (isFolded) {
            return branch.preview ? (
                <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {searchQuery.trim()
                        ? <HighlightedText text={branch.preview} searchQuery={searchQuery} />
                        : branch.preview}
                </p>
            ) : null;
        }

        return (
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
                                            {t(
                                                getStudyNoteBranchRelationTranslationKey(backlink.relationLabel)
                                                ?? backlink.relationLabel
                                            )}
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
        const selectedReferenceRelation = referenceRelationByBranchKey[branch.key] ?? '';
        const semanticLabelDraft = semanticLabelDraftByBranchKey[branch.key] ?? branch.semanticLabel ?? '';
        const normalizedSemanticLabelDraft = normalizeStudyNoteBranchSemanticLabel(semanticLabelDraft);
        const branchBacklinks = branch.branchId ? backlinksByTargetId[branch.branchId] ?? [] : [];
        const branchKindLabel = branch.branchKind
            ? t(`studiesWorkspace.outlinePilot.branchKinds.${branch.branchKind}`)
            : null;
        const branchStatusLabel = branch.branchStatus
            ? t(`studiesWorkspace.outlinePilot.branchStatuses.${branch.branchStatus}`)
            : null;

        return (
            <section
                key={branch.key}
                ref={(element) => {
                    branchRefs.current[branch.key] = element;
                }}
                id={branch.branchId ? `branch-${branch.branchId}` : undefined}
                data-testid={`study-note-branch-${branch.key}`}
                className={`rounded-2xl border shadow-sm transition-colors ${getBranchOverlayCardClassName(branch.overlayTone)} ${activeBranchKey === branch.key
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
                                    {renderBranchBadgeRow(branch, branchKindLabel, branchStatusLabel)}
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
                                {isPreview && onMoveBranch && siblingCount > 1 && renderBranchMoveControls(branch, canMoveUp, canMoveDown)}
                            </div>
                            {isPreview && onCreateBranch && renderBranchPreviewActions(
                                branch,
                                siblingIndex,
                                semanticLabelDraft,
                                normalizedSemanticLabelDraft,
                                selectedReferenceRelation
                            )}
                        </div>

                        {renderBranchContent(branch, isFolded, branchBacklinks)}
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
                        {kindFilter === 'all' && statusFilter === 'all'
                            ? t('studiesWorkspace.outlinePilot.branchCount', { count: outline.totalBranches })
                            : t('studiesWorkspace.outlinePilot.filteredBranchCount', {
                                visible: filteredBranchCount,
                                total: outline.totalBranches,
                            })}
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
                <section className="rounded-2xl border border-gray-200/80 bg-white/80 px-4 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                                {t('studiesWorkspace.outlinePilot.metadataSummary')}
                            </p>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                {t('studiesWorkspace.outlinePilot.metadataSummaryHint')}
                            </p>
                        </div>
                        {(kindFilter !== 'all' || statusFilter !== 'all') && (
                            <button
                                type="button"
                                data-testid="study-note-branch-clear-metadata-filters"
                                onClick={() => {
                                    setKindFilter('all');
                                    setStatusFilter('all');
                                }}
                                className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                            >
                                {t('studiesWorkspace.outlinePilot.clearMetadataFilters')}
                            </button>
                        )}
                    </div>

                    <div className="mt-4 space-y-3">
                        <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                                {t('studiesWorkspace.outlinePilot.branchKind')}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {branchKindOptions.map((option) => (
                                    <button
                                        key={`kind-filter-${option.value}`}
                                        type="button"
                                        data-testid={`study-note-branch-kind-filter-${option.value}`}
                                        onClick={() => setKindFilter(option.value)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${kindFilter === option.value
                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                                                : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200'
                                            }`}
                                    >
                                        {option.label} {option.value === 'all' ? outline.totalBranches : (kindCounts[option.value] ?? 0)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                                {t('studiesWorkspace.outlinePilot.branchStatus')}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {branchStatusOptions.map((option) => (
                                    <button
                                        key={`status-filter-${option.value}`}
                                        type="button"
                                        data-testid={`study-note-branch-status-filter-${option.value}`}
                                        onClick={() => setStatusFilter(option.value)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === option.value
                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                                                : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200'
                                            }`}
                                    >
                                        {option.label} {option.value === 'all' ? outline.totalBranches : (statusCounts[option.value] ?? 0)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

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

                <div className={`grid gap-6 ${showNavigator && filteredBranches.length > 1 ? 'xl:grid-cols-[240px_minmax(0,1fr)]' : ''}`}>
                    {showNavigator && filteredBranches.length > 1 && (
                        <nav className="hidden xl:block">
                            <div className="sticky top-24 rounded-2xl border border-gray-200/80 bg-white/80 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/70">
                                <ul className="space-y-1.5">
                                    {filteredBranches.map(renderNavigator)}
                                </ul>
                            </div>
                        </nav>
                    )}

                    <div className="space-y-3">
                        {filteredBranches.length > 0 ? (
                            filteredBranches.map((branch, index) =>
                                renderBranch(branch, index, filteredBranches.length)
                            )
                        ) : (
                            <section className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
                                <p>{t('studiesWorkspace.outlinePilot.noMetadataMatches')}</p>
                            </section>
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

function buildBranchMetadataCountMap<T extends 'branchKind' | 'branchStatus'>(
    branches: StudyNoteOutlineBranch[],
    field: T
): Record<string, number> {
    return branches.reduce<Record<string, number>>((counts, branch) => {
        const value = branch[field];

        if (value) {
            counts[value] = (counts[value] ?? 0) + 1;
        }

        return counts;
    }, {});
}

function filterStudyNoteOutlineBranchesByMetadata(
    branches: StudyNoteOutlineBranch[],
    filters: {
        kindFilter: BranchMetadataFilterValue<StudyNoteBranchKind>;
        statusFilter: BranchMetadataFilterValue<StudyNoteBranchStatus>;
    }
): StudyNoteOutlineBranch[] {
    return branches.flatMap((branch) => {
        const filteredChildren = filterStudyNoteOutlineBranchesByMetadata(branch.children, filters);
        const matchesKind = filters.kindFilter === 'all' || branch.branchKind === filters.kindFilter;
        const matchesStatus = filters.statusFilter === 'all' || branch.branchStatus === filters.statusFilter;
        const matchesCurrentBranch = matchesKind && matchesStatus;

        if (!matchesCurrentBranch && filteredChildren.length === 0) {
            return [];
        }

        return [{
            ...branch,
            children: filteredChildren,
        }];
    });
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
