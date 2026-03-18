import { extractStudyNoteBranchMarkdownReferences } from '@/utils/studyNoteBranchLinks';

import {
    flattenStudyNoteOutlineBranches,
    getStudyNoteOutlineBranchContentMarkdown,
    type StudyNoteOutlineBranch,
} from './studyNoteOutline';

export interface StudyNoteBranchBacklink {
    sourceBranchKey: string;
    sourceBranchTitle: string;
    sourceBranchDepth: number;
    sourceBranchId?: string;
    referenceLabel: string;
    relationLabel: string | null;
}

export type StudyNoteBranchBacklinksByTargetId = Record<string, StudyNoteBranchBacklink[]>;

export function buildStudyNoteBranchBacklinks(
    branches: StudyNoteOutlineBranch[]
): StudyNoteBranchBacklinksByTargetId {
    const backlinksByTargetId: StudyNoteBranchBacklinksByTargetId = {};
    const seenBacklinkKeys = new Set<string>();

    flattenStudyNoteOutlineBranches(branches).forEach((sourceBranch) => {
        extractStudyNoteBranchMarkdownReferences(getStudyNoteOutlineBranchContentMarkdown(sourceBranch)).forEach((reference) => {
            if (sourceBranch.branchId && sourceBranch.branchId === reference.branchId) {
                return;
            }

            const backlinkDedupeKey = JSON.stringify({
                targetBranchId: reference.branchId,
                sourceBranchKey: sourceBranch.key,
                referenceLabel: reference.label,
                relationLabel: reference.relationLabel,
            });

            if (seenBacklinkKeys.has(backlinkDedupeKey)) {
                return;
            }

            seenBacklinkKeys.add(backlinkDedupeKey);

            const backlink: StudyNoteBranchBacklink = {
                sourceBranchKey: sourceBranch.key,
                sourceBranchTitle: sourceBranch.title,
                sourceBranchDepth: sourceBranch.depth,
                sourceBranchId: sourceBranch.branchId,
                referenceLabel: reference.label,
                relationLabel: reference.relationLabel,
            };

            backlinksByTargetId[reference.branchId] = [
                ...(backlinksByTargetId[reference.branchId] ?? []),
                backlink,
            ];
        });
    });

    return backlinksByTargetId;
}
