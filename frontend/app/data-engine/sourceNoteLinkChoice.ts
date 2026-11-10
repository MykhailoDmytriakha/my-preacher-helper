import { tagMembership } from './documentTagMembership';
import { diffFields, isValidIdentifier } from './protocol';
import { legacySourceNoteChange, SOURCE_NOTE_FIELD, sourceNoteLinks, sourceNoteList } from './sourceNoteLinkAction';
import { matchesSourceNoteOpening } from './sourceNoteLinkCapture';

import type { ActionTime } from './actionClock';
import type { OrdinaryAnswerChoice } from './ordinaryAnswerChoice';
import type { SessionCheckpoint } from './session';
import type { SourceNoteChoice } from './sourceNoteLinkAction';
import type { SourceNoteLinkCapture } from './sourceNoteLinkCapture';
import type { FieldChange, ResourceSnapshot } from './types';

export function readSourceNoteLinkComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || !remoteCandidate?.value
    || !remoteCandidate.metadata || confirmed.metadata?.generation !== remoteCandidate.metadata.generation || !conflicts.length) return undefined;
  const choices = conflicts.flatMap(({ path, mine, theirs }) => {
    const noteId = path[1]?.slice(7);
    return path.length === 2 && path[0] === SOURCE_NOTE_FIELD && path[1].startsWith('string:')
      && isValidIdentifier(noteId) && typeof mine.value === 'boolean' && typeof theirs.value === 'boolean'
      && mine.value !== theirs.value && tagMembership(sourceNoteLinks(remoteCandidate.value), noteId) === theirs.value
      ? [{ noteId, mine: mine.value, stored: theirs.value }] : [];
  });
  if (choices.length !== conflicts.length) return undefined;
  return { choices, identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata.revision, choices]) };
}

/** Distinct checkbox Saves can continue together without changing any original action proof. */
export function sourceNoteChoiceTail(choice: OrdinaryAnswerChoice, saved: ResourceSnapshot | null): SourceNoteLinkCapture[] | undefined {
  if (choice.branched || !saved?.metadata || !saved.value) return undefined;
  const [first, ...tail] = choice.scope;
  const legacy = legacySourceNoteChange(first.command);
  if (!first.sourceNoteLink && !legacy) return undefined;
  const legacyBefore = legacy && sourceNoteList(legacy.before, isValidIdentifier);
  const legacyAfter = legacy && sourceNoteList(legacy.after, isValidIdentifier);
  const touched = new Set(first.sourceNoteLink?.action.changes.map(change => change.noteId)
    ?? (legacyBefore && legacyAfter && [...new Set([...legacyBefore, ...legacyAfter])]
      .filter(noteId => legacyBefore.includes(noteId) !== legacyAfter.includes(noteId))) ?? []);
  const captures: SourceNoteLinkCapture[] = [];
  const predecessors = new Map(choice.scope.map(request => [request.id, request.value]));
  for (const request of tail) {
    const capture = request.sourceNoteLink;
    const before = request.predecessor ? predecessors.get(request.predecessor) : undefined;
    if (!capture || !before || !request.value || !matchesSourceNoteOpening(saved, capture)
      || capture.action.observedRevision > saved.metadata.revision
      || diffFields(before, request.value).some(change => change.path[0] !== SOURCE_NOTE_FIELD)
      || capture.action.changes.some(change => touched.has(change.noteId))) return undefined;
    capture.action.changes.forEach(change => touched.add(change.noteId));
    captures.push(capture);
  }
  return captures;
}

export function reviewedSourceNoteLinks(checkpoint: SessionCheckpoint, original: SourceNoteLinkCapture | undefined,
  side: 'local' | 'remote', time: ActionTime | null, later: readonly SourceNoteLinkCapture[] = [],
  legacy?: FieldChange): SourceNoteLinkCapture | undefined {
  const comparison = readSourceNoteLinkComparison(checkpoint);
  if (!comparison || !checkpoint.remoteCandidate?.metadata || !checkpoint.draft) return undefined;
  const { resource, metadata, value } = checkpoint.remoteCandidate;
  const saved = sourceNoteLinks(value);
  const initial = sourceNoteList(original?.opening.selected ?? legacy?.before ?? sourceNoteLinks(checkpoint.confirmed.value), isValidIdentifier);
  const local = sourceNoteList(legacy?.after ?? sourceNoteLinks(checkpoint.draft), isValidIdentifier);
  if (!initial || !local) return undefined;
  const captured = original?.action.changes ?? [...new Set([...initial, ...local])]
    .filter(noteId => initial.includes(noteId) !== local.includes(noteId))
    .map(noteId => ({ noteId, linked: local.includes(noteId) }));
  const choices = new Map<string, SourceNoteChoice>(captured.map((change: SourceNoteChoice) => [change.noteId, {
    ...change, prior: change.prior ?? { before: initial.includes(change.noteId), observedRevision: original?.action.observedRevision ?? null,
      time: original?.action.time ?? null },
  }]));
  for (const capture of later) {
    const selected = new Set(sourceNoteList(capture.opening.selected, isValidIdentifier));
    for (const change of capture.action.changes) choices.set(change.noteId, { ...change,
      prior: change.prior ?? { before: selected.has(change.noteId), observedRevision: capture.action.observedRevision, time: capture.action.time },
    });
  }
  for (const choice of comparison.choices) {
    if (side === 'remote') choices.delete(choice.noteId);
    else choices.set(choice.noteId, { noteId: choice.noteId, linked: choice.mine });
  }
  if (!choices.size) return undefined;
  return { opening: { sermonId: resource.id, generation: metadata.generation, revision: metadata.revision, selected: saved, pending: [] },
    action: { observedRevision: metadata.revision, time, reviewed: true,
      changes: [...choices.values()] } };
}
