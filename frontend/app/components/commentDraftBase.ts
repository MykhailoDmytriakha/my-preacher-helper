import { engineNote, storedReferences } from '@/hooks/useStudyNotesEngine';
import { serializeContent } from '@/utils/contentFingerprint';

import type { DocumentData } from '@/data-engine/types';
import type { ScriptureReference, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

/*
 * A WRITTEN COMMENT'S DRAFT IS A FROZEN WINDOW SESSION: the words and what they were built from. The comment's window
 * measures what it changed from one version (`mine` — where its edits began) and guards each such field with another
 * (`opened` — the version it works from, the other device's once «keep mine» took it); `CommentDialog` `changesOf`.
 * Restoring the draft resumes that session — the words AND both versions — so the window's ordinary save sends only what
 * the session changed and the existing check (`useStudyNotesEngine.updateNote`) decides: accept, merge, or refuse, and the
 * window asks its existing question. Nothing here compares one version with another; it only keeps and restores what the
 * check needs. The note page keeps its draft the same way (`studies/[id]/noteDraftBase.ts`).
 */

/** The fields of a written comment its window's save measures and guards: words, kind, name, place, revision. */
type CommentVersion = Pick<StudyNote, 'content' | 'type' | 'title' | 'paragraph' | 'scriptureRefs' | 'rev'>;

/** What a written comment's draft keeps beside its words; `mine` only where it is not the opened version. */
export type CommentDraftBase = { opened: CommentVersion; mine?: CommentVersion };

/** A version as the device keeps it: its references as STORED data, which the check compares (`storedReferences`). */
function keptVersion(note: StudyNote): CommentVersion {
  return { content: note.content, type: note.type, title: note.title, paragraph: note.paragraph,
    scriptureRefs: storedReferences(note.scriptureRefs) as ScriptureReference[], rev: note.rev };
}

/** The base a written comment's draft keeps: the window's two versions as they are at this write. */
export function commentDraftBase(opened: StudyNote | undefined, mine: StudyNote | undefined): CommentDraftBase | undefined {
  if (!opened) return undefined;
  const base: CommentDraftBase = { opened: keptVersion(opened) };
  const measured = mine && keptVersion(mine);
  return measured && serializeContent(measured) !== serializeContent(base.opened) ? { ...base, mine: measured } : base;
}

const textOrAbsent = (value: unknown) => value === undefined || value === null || typeof value === 'string';

/** A kept version the window can read: each field a value of its kind or absent; the place a list. */
function readableVersion(kept: unknown): kept is CommentVersion {
  if (!kept || typeof kept !== 'object') return false;
  const version = kept as Record<string, unknown>;
  return textOrAbsent(version.content) && textOrAbsent(version.type) && textOrAbsent(version.title)
    && (version.paragraph === undefined || version.paragraph === null || typeof version.paragraph === 'boolean')
    && Array.isArray(version.scriptureRefs) && version.scriptureRefs.every(item => item !== null && typeof item === 'object')
    && (version.rev === undefined || (version.rev !== null && typeof version.rev === 'object'));
}

/**
 * The window session a restored draft resumes, or null when the copy kept no readable base (written before copies kept
 * one): what its words were built from is then unknown, and the window guards what it sends with an unknown value.
 * Each version is laid over the comment as shown — every field it keeps set, an absent one too — and its stored
 * references are read back as the engine's list reads them (`engineNote`, in the interface's language), so the window
 * resumes with the reading it had: the reader's paragraph rule is asked of the same place, and the check maps the reading
 * back to the stored list it compares.
 */
export function resumedCommentSession(kept: unknown, shown: StudyNote, locale: AppLocale): { opened: StudyNote; mine: StudyNote } | null {
  if (!kept || typeof kept !== 'object') return null;
  const { opened, mine = opened } = kept as { opened?: unknown; mine?: unknown };
  if (!readableVersion(opened) || !readableVersion(mine)) return null;
  const resumed = (version: CommentVersion): StudyNote => ({
    ...shown,
    content: version.content, type: version.type, title: version.title, paragraph: version.paragraph, rev: version.rev,
    scriptureRefs: engineNote({ type: version.type ?? undefined, scriptureRefs: version.scriptureRefs } as unknown as DocumentData, shown.id, locale).scriptureRefs,
  });
  return { opened: resumed(opened), mine: resumed(mine) };
}

/** What a save guards with when the words' base is unknown: every field it sends, an unknown value (null). */
export function guardedByUnknownBase(baseline: Record<string, unknown>, updates: Partial<StudyNote>): Record<string, unknown> {
  return { ...baseline, ...Object.fromEntries(Object.keys(updates).map(field => [field, null])) };
}
