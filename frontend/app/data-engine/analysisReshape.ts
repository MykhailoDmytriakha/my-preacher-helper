import { ANALYSIS_RESHAPE_FIELDS, sameAnalysisFrame } from './analysisReshapeFields';
import { equalValues } from './protocol';
import { pinSavedDocument } from './savedDocumentPin';
import { DataSession } from './session';

import type { AtomicCapture, CommitRequest } from './commits';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

/** Expected values retain the exact stored reference ancestry, not a locale-normalized reading. */
export interface StudyAnalysisWrite { resource: ResourceRef; expected: DocumentData | null; value: DocumentData }
const refuse = (code = 'resolve-version-first'): never => { throw Object.assign(new Error(code), { code }); };

function reshapedExistingValue(edit: StudyAnalysisWrite, ancestor: DocumentData): DocumentData {
  const value = { ...ancestor };
  for (const field of ANALYSIS_RESHAPE_FIELDS) {
    if (field === 'title' && equalValues(edit.expected?.title, edit.value.title)) continue;
    if (field === 'title' && !equalValues(edit.expected?.title, ancestor.title)
      && !equalValues(edit.value.title, ancestor.title)) return refuse();
    if (Object.prototype.hasOwnProperty.call(edit.value, field)) value[field] = edit.value[field];
    else delete value[field];
  }
  return value;
}

/** Freeze only this reshape's authored frame against one proven saved chain for every note. */
export function captureAnalysisReshape(owner: string, actionId: string, edits: readonly StudyAnalysisWrite[],
  snapshots: readonly ResourceSnapshot[], requests: readonly CommitRequest[]): AtomicCapture[] {
  if (edits.length < 2 || edits.length > 3 || edits[0].expected === null
    || new Set(edits.map(edit => edit.resource.id)).size !== edits.length) return refuse('invalid-argument');
  return edits.map((edit, index) => {
    const snapshot = snapshots[index];
    if (edit.resource.collection !== 'studyNotes' || !snapshot || !equalValues(snapshot.resource, edit.resource)
      || edit.value.userId !== owner) return refuse('invalid-argument');
    if (snapshot.metadata?.deleted) return refuse();
    const pinned = pinSavedDocument(owner, snapshot, requests);
    if (pinned.conflicts.length || (pinned.draft && pinned.draft.userId !== owner)) return refuse();
    const predecessorId = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
    if (!edit.expected) {
      if (index === 0 || pinned.draft || pinned.confirmed.metadata || predecessorId) return refuse();
    } else if (!pinned.draft || edit.expected.userId !== owner || !sameAnalysisFrame(edit.expected, pinned.draft)) return refuse();
    const baseline = pinned.confirmed;
    const value = pinned.draft ? reshapedExistingValue(edit, pinned.draft) : edit.value;
    const session = new DataSession(baseline); session.edit(value);
    return { editorId: JSON.stringify([actionId, 'analysis-reshape', edit.resource.id]), captured: session.checkpoint(), predecessorId };
  });
}
