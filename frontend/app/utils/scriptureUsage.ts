import { referencesInText } from '@/utils/bibleLink';
import { documentScreenHref } from '@/utils/documentScreenHref';
import { markdownPreviewText } from '@/utils/markdownUtils';
import { readPlanText, renderPlanWithFallback } from '@/utils/planText';
import { sameScriptureReference, scriptureReferencesOverlap, withNoteReferenceBibles, withStoredBible } from '@/utils/scriptureReferenceNumbering';

import type { Group, Sermon, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

export type ScriptureUsageKind = 'note' | 'sermon' | 'group';
export type ScriptureUsageMatch = 'same' | 'overlap' | 'text';
export type ScriptureUsage = {
  id: string;
  kind: ScriptureUsageKind;
  title: string;
  href: string;
  reference: ScriptureRefShape;
  match: ScriptureUsageMatch;
  excerpt: string;
  /** Full source unit for the preview: a note, or the matching sermon/group text. */
  content: string;
  /** The words naming the passage inside `content`, for the preview to find; absent when only a reference list names it. */
  mention?: string;
};
type Candidate = { reference: ScriptureRefShape; text: string; at: number; inText: boolean; raw?: string };
type UsageSources = { notes: readonly StudyNote[]; sermons: readonly Sermon[]; groups: readonly Group[]; currentNoteId: string; locale: AppLocale };

/** Stronger links first: the same reference, then an overlapping passage, then a mention in the text. */
const MATCH_ORDER: Record<ScriptureUsageMatch, number> = { same: 0, overlap: 1, text: 2 };

/**
 * A bounded excerpt around the actual mention, rather than an unrelated first paragraph, read as
 * plain words: Markdown marks and line breaks would fill a short row without saying anything.
 */
function excerpt(text: string, at = 0): string {
  const near = Math.max(0, at - 60);
  // Start on a word, not inside one; and at the top when only marks would be skipped.
  const onWord = near && /\S/.test(text[near - 1] ?? '') ? Math.min(at, text.indexOf(' ', near) + 1 || near) : near;
  const start = markdownPreviewText(text.slice(0, onWord)) ? onWord : 0;
  const end = Math.min(text.length, Math.max(at + 200, start + 260));
  return `${start ? '…' : ''}${markdownPreviewText(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

function inText(text: string, locale: AppLocale): Candidate[] {
  return referencesInText(text, locale).map(found => ({ reference: found.reference, text, at: found.start, inText: true, raw: found.raw }));
}

/**
 * Explicit uses only. A source-note relationship or a similar topic does not prove that this
 * material contains the verse. Results count documents once, even when several mentions overlap.
 */
export function findScriptureUsage(target: ScriptureRefShape, sources: UsageSources): ScriptureUsage[] {
  const { notes, sermons, groups, currentNoteId, locale } = sources;
  const selected = withStoredBible(target, locale);
  const results: Array<{ usage: ScriptureUsage; updatedAt: string }> = [];
  const matchOf = (candidate: Candidate): ScriptureUsageMatch =>
    candidate.inText ? 'text' : sameScriptureReference(selected, candidate.reference) ? 'same' : 'overlap';
  // The words in a text that name the opened passage itself, the very reference first.
  const mentionIn = (mentions: Candidate[]) => mentions.find(mention => sameScriptureReference(selected, mention.reference))
    ?? mentions.find(mention => scriptureReferencesOverlap(selected, mention.reference));
  const add = (kind: ScriptureUsageKind, id: string, title: string, collection: string, updatedAt: string | undefined, candidates: Candidate[]) => {
    // A document is listed once, by its strongest link to the passage.
    const found = candidates.filter(candidate => scriptureReferencesOverlap(selected, candidate.reference))
      .sort((a, b) => MATCH_ORDER[matchOf(a)] - MATCH_ORDER[matchOf(b)])[0];
    const href = documentScreenHref({ collection, id });
    if (!found || !href) return;
    results.push({ updatedAt: updatedAt ?? '', usage: { id, kind, title, href, reference: found.reference, match: matchOf(found),
      excerpt: excerpt(found.text, found.at), content: found.text, ...(found.raw ? { mention: found.raw } : {}) } });
  };
  notes.forEach(stored => {
    if (stored.id === currentNoteId) return;
    const note = withNoteReferenceBibles(stored, locale);
    const mentions = inText(note.content ?? '', locale);
    add('note', note.id, note.title ?? '', 'studyNotes', note.updatedAt, [
      ...(note.scriptureRefs ?? []).map(reference => {
        const typed = mentionIn(mentions);
        return { reference, text: note.content ?? '', at: typed?.at ?? 0, inText: false, raw: typed?.raw };
      }),
      ...mentions,
    ]);
  });
  sermons.forEach(sermon => {
    const plan = renderPlanWithFallback(sermon, readPlanText(sermon));
    add('sermon', sermon.id, sermon.title, 'sermons', sermon.updatedAt, [
      ...inText(sermon.verse ?? '', locale).map(candidate => ({ ...candidate, inText: false })),
      ...inText(Object.values(plan).join('\n\n'), locale),
      ...(sermon.thoughts ?? []).flatMap(thought => inText(thought.text, locale)),
      ...(sermon.scratch ?? []).flatMap(scratch => inText(scratch.text, locale)),
    ]);
  });
  groups.forEach(group => {
    add('group', group.id, group.title, 'groups', group.updatedAt, (group.templates ?? []).flatMap(block => [
      ...(block.scriptureRefs ?? []).flatMap(raw => inText(raw, locale).map(candidate => ({ ...candidate, text: `${block.title}\n${block.content}`, at: 0, inText: false, raw: undefined }))),
      ...inText(`${block.title}\n${block.content}`, locale),
    ]));
  });
  return results
    .sort((a, b) => MATCH_ORDER[a.usage.match] - MATCH_ORDER[b.usage.match] || b.updatedAt.localeCompare(a.updatedAt))
    .map(({ usage }) => usage);
}
