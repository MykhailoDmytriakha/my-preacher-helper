import {
    StudyNoteBranchKind,
    StudyNoteBranchStateRecord,
    StudyNoteBranchStatus,
} from '@/models/models';

import {
    flattenStudyNoteOutlineBranches,
    getStudyNoteOutlineBranchChildOrder,
    getStudyNoteOutlineBranchNodeblocks,
    type StudyNoteOutlineChildOrderEntry,
    type StudyNoteOutlineBranch,
    type StudyNoteOutlineNodeblock,
} from './studyNoteOutline';

interface StudyNoteBranchDescriptor {
    branch: StudyNoteOutlineBranch;
    titleSlug: string;
    parentSlugChain: string[];
    bodyHash: string;
    subtreeHash: string;
    subtreeContentHash: string;
    subtreeOccurrenceIndex: number;
    contextualOccurrenceIndex: number;
    relaxedOccurrenceIndex: number;
    contextualContentOccurrenceIndex: number;
    relaxedContentOccurrenceIndex: number;
}

interface MutableOccurrenceMap {
    subtree: Map<string, number>;
    contextual: Map<string, number>;
    relaxed: Map<string, number>;
    contextualContent: Map<string, number>;
    relaxedContent: Map<string, number>;
}

export interface HydratedStudyNoteBranchIdentity {
    branches: StudyNoteOutlineBranch[];
    branchIdByKey: Record<string, string>;
    keyByBranchId: Record<string, string>;
    branchRecords: StudyNoteBranchStateRecord[];
}

export const STUDY_NOTE_BRANCH_KIND_VALUES: StudyNoteBranchKind[] = [
    'summary',
    'insight',
    'evidence',
    'question',
    'application',
];

export const STUDY_NOTE_BRANCH_STATUS_VALUES: StudyNoteBranchStatus[] = [
    'active',
    'tentative',
    'confirmed',
    'resolved',
];

export function normalizeStudyNoteBranchSemanticLabel(value?: string | null): string | null {
    const normalizedValue = value?.replace(/\s+/g, ' ').trim() ?? '';

    return normalizedValue ? normalizedValue : null;
}

export function normalizeStudyNoteBranchKind(value?: string | null): StudyNoteBranchKind | null {
    return STUDY_NOTE_BRANCH_KIND_VALUES.includes(value as StudyNoteBranchKind)
        ? value as StudyNoteBranchKind
        : null;
}

export function normalizeStudyNoteBranchStatus(value?: string | null): StudyNoteBranchStatus | null {
    return STUDY_NOTE_BRANCH_STATUS_VALUES.includes(value as StudyNoteBranchStatus)
        ? value as StudyNoteBranchStatus
        : null;
}

function cloneBranch(branch: StudyNoteOutlineBranch): StudyNoteOutlineBranch {
    return {
        ...branch,
        nodeblocks: getStudyNoteOutlineBranchNodeblocks(branch).map(cloneNodeblock),
        childOrder: getStudyNoteOutlineBranchChildOrder(branch).map((entry): StudyNoteOutlineChildOrderEntry => ({
            ...entry,
        })),
        children: branch.children.map(cloneBranch),
    };
}

function cloneNodeblock(nodeblock: StudyNoteOutlineNodeblock): StudyNoteOutlineNodeblock {
    return {
        ...nodeblock,
        children: nodeblock.children.map(cloneNodeblock),
    };
}

function slugifyTitle(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}

function hashText(value: string): string {
    let hash = 5381;

    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    }

    return (hash >>> 0).toString(36);
}

function getBodyHash(body: string): string {
    return hashText(body.trim());
}

function getNodeblockHash(nodeblock: StudyNoteOutlineNodeblock): string {
    return hashText(
        JSON.stringify({
            bodyHash: getBodyHash(nodeblock.body),
            children: nodeblock.children.map((childNodeblock) => getNodeblockHash(childNodeblock)),
        })
    );
}

function getSubtreeHash(branch: StudyNoteOutlineBranch): string {
    return hashText(
        JSON.stringify({
            titleSlug: slugifyTitle(branch.title),
            bodyHash: getBodyHash(branch.body),
            nodeblocks: getStudyNoteOutlineBranchNodeblocks(branch).map((nodeblock) => getNodeblockHash(nodeblock)),
            children: branch.children.map((childBranch) => getSubtreeHash(childBranch)),
        })
    );
}

function getSubtreeContentHash(branch: StudyNoteOutlineBranch): string {
    return hashText(
        JSON.stringify({
            bodyHash: getBodyHash(branch.body),
            nodeblocks: getStudyNoteOutlineBranchNodeblocks(branch).map((nodeblock) => getNodeblockHash(nodeblock)),
            children: branch.children.map((childBranch) => getSubtreeContentHash(childBranch)),
        })
    );
}

function getSubtreeSignature(descriptor: Pick<StudyNoteBranchDescriptor, 'subtreeHash'>): string {
    return descriptor.subtreeHash;
}

function getContextualSignature(
    descriptor: Pick<StudyNoteBranchDescriptor, 'titleSlug' | 'parentSlugChain' | 'bodyHash'>
): string {
    return JSON.stringify({
        titleSlug: descriptor.titleSlug,
        parentSlugChain: descriptor.parentSlugChain,
        bodyHash: descriptor.bodyHash,
    });
}

function getRelaxedSignature(
    descriptor: Pick<StudyNoteBranchDescriptor, 'titleSlug' | 'bodyHash'>
): string {
    return JSON.stringify({
        titleSlug: descriptor.titleSlug,
        bodyHash: descriptor.bodyHash,
    });
}

function getContextualContentSignature(
    descriptor: Pick<StudyNoteBranchDescriptor, 'parentSlugChain' | 'subtreeContentHash'>
): string {
    return JSON.stringify({
        parentSlugChain: descriptor.parentSlugChain,
        subtreeContentHash: descriptor.subtreeContentHash,
    });
}

function getRelaxedContentSignature(
    descriptor: Pick<StudyNoteBranchDescriptor, 'subtreeContentHash'>
): string {
    return descriptor.subtreeContentHash;
}

function getAndIncrementOccurrenceIndex(
    map: Map<string, number>,
    signature: string
): number {
    const occurrenceIndex = map.get(signature) ?? 0;
    map.set(signature, occurrenceIndex + 1);
    return occurrenceIndex;
}

function collectDescriptors(
    branches: StudyNoteOutlineBranch[],
    parentSlugChain: string[] = [],
    occurrenceMap: MutableOccurrenceMap = {
        subtree: new Map<string, number>(),
        contextual: new Map<string, number>(),
        relaxed: new Map<string, number>(),
        contextualContent: new Map<string, number>(),
        relaxedContent: new Map<string, number>(),
    }
): StudyNoteBranchDescriptor[] {
    return branches.flatMap((branch) => {
        const titleSlug = slugifyTitle(branch.title);
        const currentParentSlugChain = parentSlugChain;
        const descriptorBase = {
            branch,
            titleSlug,
            parentSlugChain: currentParentSlugChain,
            bodyHash: getBodyHash(branch.body),
            subtreeHash: getSubtreeHash(branch),
            subtreeContentHash: getSubtreeContentHash(branch),
        };
        const subtreeOccurrenceIndex = getAndIncrementOccurrenceIndex(
            occurrenceMap.subtree,
            getSubtreeSignature(descriptorBase)
        );
        const contextualOccurrenceIndex = getAndIncrementOccurrenceIndex(
            occurrenceMap.contextual,
            getContextualSignature(descriptorBase)
        );
        const relaxedOccurrenceIndex = getAndIncrementOccurrenceIndex(
            occurrenceMap.relaxed,
            getRelaxedSignature(descriptorBase)
        );
        const contextualContentOccurrenceIndex = getAndIncrementOccurrenceIndex(
            occurrenceMap.contextualContent,
            getContextualContentSignature(descriptorBase)
        );
        const relaxedContentOccurrenceIndex = getAndIncrementOccurrenceIndex(
            occurrenceMap.relaxedContent,
            getRelaxedContentSignature(descriptorBase)
        );
        const descriptor: StudyNoteBranchDescriptor = {
            ...descriptorBase,
            subtreeOccurrenceIndex,
            contextualOccurrenceIndex,
            relaxedOccurrenceIndex,
            contextualContentOccurrenceIndex,
            relaxedContentOccurrenceIndex,
        };

        return [
            descriptor,
            ...collectDescriptors(branch.children, [...currentParentSlugChain, titleSlug], occurrenceMap),
        ];
    });
}

function createBranchRecord(
    descriptor: StudyNoteBranchDescriptor,
    branchId: string
): StudyNoteBranchStateRecord {
    return {
        branchId,
        overlayTone: descriptor.branch.overlayTone ?? null,
        semanticLabel: normalizeStudyNoteBranchSemanticLabel(descriptor.branch.semanticLabel),
        branchKind: normalizeStudyNoteBranchKind(descriptor.branch.branchKind),
        branchStatus: normalizeStudyNoteBranchStatus(descriptor.branch.branchStatus),
        title: descriptor.branch.title,
        titleSlug: descriptor.titleSlug,
        parentSlugChain: descriptor.parentSlugChain,
        bodyHash: descriptor.bodyHash,
        subtreeHash: descriptor.subtreeHash,
        subtreeContentHash: descriptor.subtreeContentHash,
        subtreeOccurrenceIndex: descriptor.subtreeOccurrenceIndex,
        contextualOccurrenceIndex: descriptor.contextualOccurrenceIndex,
        relaxedOccurrenceIndex: descriptor.relaxedOccurrenceIndex,
        contextualContentOccurrenceIndex: descriptor.contextualContentOccurrenceIndex,
        relaxedContentOccurrenceIndex: descriptor.relaxedContentOccurrenceIndex,
        lastKnownKey: descriptor.branch.key,
    };
}

function findMatchingDescriptor(
    descriptorPool: Map<string, StudyNoteBranchDescriptor>,
    record: StudyNoteBranchStateRecord,
    getSignature: (descriptor: StudyNoteBranchDescriptor | StudyNoteBranchStateRecord) => string,
    getOccurrenceIndex: (
        descriptor: StudyNoteBranchDescriptor | StudyNoteBranchStateRecord
    ) => number
): StudyNoteBranchDescriptor | null {
    for (const descriptor of descriptorPool.values()) {
        if (
            getSignature(descriptor) === getSignature(record) &&
            getOccurrenceIndex(descriptor) === getOccurrenceIndex(record)
        ) {
            return descriptor;
        }
    }

    return null;
}

export function hydrateStudyNoteBranchIdentity(
    branches: StudyNoteOutlineBranch[],
    branchRecords: StudyNoteBranchStateRecord[]
): HydratedStudyNoteBranchIdentity {
    const hydratedBranches = branches.map(cloneBranch);
    const descriptors = collectDescriptors(hydratedBranches);
    const descriptorPool = new Map(descriptors.map((descriptor) => [descriptor.branch.key, descriptor]));

    const attachBranchIds = (
        getSignature: (descriptor: StudyNoteBranchDescriptor | StudyNoteBranchStateRecord) => string,
        getOccurrenceIndex: (
            descriptor: StudyNoteBranchDescriptor | StudyNoteBranchStateRecord
        ) => number
    ) => {
        branchRecords.forEach((record) => {
            if (descriptors.some((descriptor) => descriptor.branch.branchId === record.branchId)) {
                return;
            }

            const matchingDescriptor = findMatchingDescriptor(
                descriptorPool,
                record,
                getSignature,
                getOccurrenceIndex
            );

            if (!matchingDescriptor) {
                return;
            }

            matchingDescriptor.branch.branchId = record.branchId;
            matchingDescriptor.branch.overlayTone = record.overlayTone ?? null;
            matchingDescriptor.branch.semanticLabel = normalizeStudyNoteBranchSemanticLabel(record.semanticLabel);
            matchingDescriptor.branch.branchKind = normalizeStudyNoteBranchKind(record.branchKind);
            matchingDescriptor.branch.branchStatus = normalizeStudyNoteBranchStatus(record.branchStatus);
            descriptorPool.delete(matchingDescriptor.branch.key);
        });
    };

    attachBranchIds(
        getSubtreeSignature,
        (descriptor) => descriptor.subtreeOccurrenceIndex
    );
    attachBranchIds(
        getContextualSignature,
        (descriptor) => descriptor.contextualOccurrenceIndex
    );
    attachBranchIds(
        getRelaxedSignature,
        (descriptor) => descriptor.relaxedOccurrenceIndex
    );
    attachBranchIds(
        getContextualContentSignature,
        (descriptor) => descriptor.contextualContentOccurrenceIndex
    );
    attachBranchIds(
        getRelaxedContentSignature,
        (descriptor) => descriptor.relaxedContentOccurrenceIndex
    );

    const branchIdByKey: Record<string, string> = {};
    const keyByBranchId: Record<string, string> = {};
    const nextBranchRecords = collectDescriptors(hydratedBranches)
        .filter((descriptor) => Boolean(descriptor.branch.branchId))
        .map((descriptor) => {
            const branchId = descriptor.branch.branchId!;
            branchIdByKey[descriptor.branch.key] = branchId;
            keyByBranchId[branchId] = descriptor.branch.key;
            return createBranchRecord(descriptor, branchId);
        });

    return {
        branches: hydratedBranches,
        branchIdByKey,
        keyByBranchId,
        branchRecords: nextBranchRecords,
    };
}

export function createStudyNoteBranchStateRecord(
    branches: StudyNoteOutlineBranch[],
    branchKey: string,
    branchId: string
): StudyNoteBranchStateRecord | null {
    const targetDescriptor = collectDescriptors(branches).find((descriptor) => descriptor.branch.key === branchKey);

    if (!targetDescriptor) {
        return null;
    }

    return createBranchRecord(targetDescriptor, branchId);
}

export function mapFoldedBranchIdsToKeys(
    foldedBranchIds: string[],
    keyByBranchId: Record<string, string>
): string[] {
    return foldedBranchIds.flatMap((branchId) => {
        const branchKey = keyByBranchId[branchId];
        return branchKey ? [branchKey] : [];
    });
}

export function filterKnownBranchIds(
    candidateBranchIds: string[],
    branchRecords: StudyNoteBranchStateRecord[]
): string[] {
    const knownBranchIds = new Set(branchRecords.map((record) => record.branchId));

    return candidateBranchIds.filter((branchId) => knownBranchIds.has(branchId));
}

export function upsertStudyNoteBranchStateRecords(
    existingRecords: StudyNoteBranchStateRecord[],
    nextRecords: StudyNoteBranchStateRecord[]
): StudyNoteBranchStateRecord[] {
    const recordMap = new Map(existingRecords.map((record) => [record.branchId, record]));

    nextRecords.forEach((record) => {
        recordMap.set(record.branchId, record);
    });

    return Array.from(recordMap.values());
}

export function flattenHydratedStudyNoteOutlineBranches(
    branches: StudyNoteOutlineBranch[]
): StudyNoteOutlineBranch[] {
    return flattenStudyNoteOutlineBranches(branches);
}
