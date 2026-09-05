/**
 * A STUDY NOTE, BROKEN INTO THE SECTIONS ITS AUTHOR WROTE.
 *
 * The cut of a note into scratch notes is done in slices, not in one breath: one model
 * call for the whole manuscript ran 36 seconds against a 60-second serverless wall, left
 * no room for a second attempt, and gave the person a minute of blank waiting. Sections
 * are the unit to slice by because the author already drew those lines — a slice never
 * splits a thought in half, and the progress the person sees ("sections 1-6") is the
 * progress they can recognise in their own note.
 *
 * The heading line stays WITH its section: the model reads it as the section's title, and
 * the route grounds what comes back against the headings the note really writes.
 */
import { countWords } from './noteCutCorridor';

export interface NoteSection {
  /** Position in the note, from 0, in reading order. */
  index: number;
  /** The heading as written, without # marks. Empty for the text before the first one. */
  heading: string;
  /** The section's raw markdown, heading line included. */
  text: string;
  words: number;
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/**
 * Sections in document order. Text before the first heading becomes a section with an
 * empty heading — a note may have no headings at all, and it still has to be cuttable.
 */
export function splitNoteIntoSections(content: string): NoteSection[] {
  if (!content.trim()) return [];
  const sections: NoteSection[] = [];
  let heading = '';
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = lines.join('\n').trim();
    if (!text) return;
    sections.push({ index: sections.length, heading, text, words: countWords(text) });
  };

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match) {
      flush();
      heading = match[1].replace(/[*_`]/g, '').trim();
      lines = [raw];
      continue;
    }
    lines.push(raw);
  }
  flush();
  return sections;
}

/** The slice `[offset, offset + limit)`; an absent or unusable limit means "to the end". */
export function sliceSections(sections: NoteSection[], offset: number, limit?: number): NoteSection[] {
  const from = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const take = Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : sections.length;
  return sections.slice(from, from + take);
}

/** The slice as the model reads it — the author's own text, nothing added. */
export function sectionsText(sections: NoteSection[]): string {
  return sections.map((section) => section.text).join('\n\n');
}

/**
 * HOW BIG A SLICE MAY BE, in words of study text.
 *
 * Measured, not guessed: 6,300 words were cut in 36.2s on the live check, so the model
 * works through roughly 175 words a second. Three thousand words is about seventeen
 * seconds — a third of the 60s function ceiling, which leaves room for the model call to
 * be retried inside the same request when the provider hiccups.
 *
 * Bigger rather than smaller on purpose: every slice is a separate AI call against the
 * person's quota, so slicing finer would make a long note cost them more.
 */
export const SLICE_WORD_BUDGET = 3000;

/**
 * The slices a note will be cut in — balanced, in reading order, never splitting a
 * section. Greedy packing to the budget leaves a dribble at the end (six, six, one) and
 * that lonely tail costs a whole AI call for one section, so the number of slices is
 * decided first — `ceil(words / budget)` — and the sections are then spread evenly over
 * them. A section longer than the budget rides alone, because the alternative is cutting
 * the author's argument in half to please a number.
 */
export function planNoteCutSlices(
  sections: Pick<NoteSection, 'words'>[],
  wordBudget = SLICE_WORD_BUDGET
): { offset: number; limit: number; words: number }[] {
  if (sections.length === 0) return [];
  const budget = wordBudget > 0 ? wordBudget : SLICE_WORD_BUDGET;
  const total = sections.reduce((sum, section) => sum + section.words, 0);
  const count = Math.min(sections.length, Math.max(1, Math.ceil(total / budget)));
  const target = total / count;

  const slices: { offset: number; limit: number; words: number }[] = [];
  let offset = 0;
  let limit = 0;
  let words = 0;
  let running = 0;
  for (const section of sections) {
    limit += 1;
    words += section.words;
    running += section.words;
    // Enough sections must be left to fill every slice still to be opened.
    const roomForMore = sections.length - (offset + limit) >= count - slices.length - 1;
    if (slices.length < count - 1 && running >= target * (slices.length + 1) && roomForMore) {
      slices.push({ offset, limit, words });
      offset += limit;
      limit = 0;
      words = 0;
    }
  }
  if (limit > 0) slices.push({ offset, limit, words });
  return slices;
}
