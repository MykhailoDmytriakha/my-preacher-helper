import { readMarkdownHtml } from '@/utils/markdownHtml';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';

import type { AppLocale } from '@/utils/appLocale';
import type { Element, Root, Text } from 'hast';

/**
 * THE SHAPE OF A PLAN CELL BUILT FROM A NOTE (owner, 2026-11-21, case «Структура плана»). A sermon is built on
 * Scripture: the preacher reads a place and explains it. So a point opens with an ENTRY (a question or a short
 * overview that turns the listener to the new theme), goes through numbered STEPS — each standing on its place of
 * Scripture: the verse first, then the thoughts that explain it, examples last — and ends with a CONCLUSION that
 * closes the thought before the next point. A comparison across audiences (brothers / sisters) is a table.
 *
 *   {entry}
 *
 *   *{main verse of the point}*
 *
 *   1. **{step}** — {gist}
 *
 *      *{verse: «its own words, retelling the place»}*
 *
 *      - {thought}
 *
 *   | | {column} | {column} |
 *
 *   **Вывод:** {conclusion}
 *
 * The model returns only the filling; this module owns the form, so every answer reads the same on the page,
 * in «Проповедовать» and in the Word export (a step's verses and thoughts are list content: indented everywhere).
 */
export interface NotePlanStep {
  title: string;
  gist: string | null;
  refs: string[];
  thoughts: string[];
}

export interface NotePlanTable {
  columns: string[];
  rows: { label: string; cells: string[] }[];
}

export interface NotePlanNodeFilling {
  entry: string | null;
  refs: string[];
  steps: NotePlanStep[];
  table: NotePlanTable | null;
  conclusion: string | null;
}

/** How deep a step's content sits under its number: the width of its marker — "1. " is 3, "10. " is 4. */
const contentIndent = (number: number): string => ' '.repeat(`${number}. `.length);

export type NotePlanLanguage = AppLocale;

const count = (text: string, letters: RegExp) => text.match(letters)?.length ?? 0;

/**
 * The language the cell is written in — the model writes in the preacher's — for the conclusion's label. Letters only
 * one of the two languages has decide it; Cyrillic without them («Бог дав нам Слово») takes the request's language.
 */
export function noteLanguage(written: string, requested?: AppLocale): NotePlanLanguage {
  const text = written.replace(/<[^>]*>/g, ' ');
  const latin = count(text, /[a-z]/gi);
  const cyrillic = count(text, /[а-яёіїєґ]/gi);
  if (!latin && !cyrillic) return requested ?? 'en';
  if (latin > cyrillic) return 'en';
  const ukrainian = count(text, /[іїєґІЇЄҐ]/g);
  const russian = count(text, /[ыэъёЫЭЪЁ]/g);
  // One letter in a quoted word does not decide a cell: the side with more of its own letters does, at least two.
  if (ukrainian > russian && ukrainian >= 2) return 'uk';
  if (russian > ukrainian && russian >= 2) return 'ru';
  if (/[а-яА-Я]/.test(text)) return requested === 'uk' ? 'uk' : 'ru';
  return 'en';
}

/** One line of the model's text; a «<» is written as text, so no tag in an answer can reach past its paragraph or cell. */
const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().replace(/</g, '&lt;');

/** A verse line as written: the reference and the words of the place, without emphasis the assembler adds itself. */
const verse = (ref: string): string => clean(ref).replace(/^\*+|\*+$/g, '').replace(/\.{3}/g, '…').trim();

/** A step's name never carries its own number or markup: the list numbers it and the assembler bolds it. */
const stepTitle = (title: string | null): string => clean(title).replace(/^\d+[.)]\s*/, '').replace(/[*`]/g, '').replace(/\\+$/, '').trim();

const thought = (text: string): string => clean(text).replace(/^[-*•]\s+/, '');

/** A table cell is one line of inline text: a pipe is escaped (it would split the cell), a line break would end the row. */
const tableCell = (text: string): string => clean(text).replace(/(\\*)\|/g, (_, slashes: string) => `${slashes}${slashes.length % 2 ? '' : '\\'}|`);

function tableMarkdown(table: NotePlanTable): string | null {
  const columns = table.columns.map(tableCell);
  const rows = table.rows.filter((row) => clean(row.label) || row.cells.some((cell) => clean(cell)));
  if (!columns.length || !rows.length) return null;
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(['', ...columns]),
    line(['---', ...columns.map(() => '---')]),
    ...rows.map((row) => line([tableCell(row.label), ...columns.map((_, index) => tableCell(row.cells[index] ?? ''))])),
  ].join('\n');
}

function stepMarkdown(step: NotePlanStep, number: number): string | null {
  const refs = step.refs.map(verse).filter(Boolean);
  const thoughts = step.thoughts.map(thought).filter(Boolean);
  // A step always has a name to stand on: a bare «1.» lets its verses fall out of the list.
  let title = stepTitle(step.title);
  let gist = clean(step.gist);
  if (!title && gist) [title, gist] = [stepTitle(gist), ''];
  if (!title && refs.length) title = stepTitle(refs[0].split(/:\s/)[0]);
  if (!title && thoughts.length) title = stepTitle(thoughts.shift() ?? '');
  if (!title) return null;
  const indent = contentIndent(number);
  const blocks = [`${number}. **${title}**${gist ? ` — ${gist}` : ''}`];
  refs.forEach((ref) => blocks.push(`${indent}*${ref}*`));
  if (thoughts.length) blocks.push(thoughts.map((item) => `${indent}- ${item}`).join('\n'));
  return blocks.join('\n\n');
}

/**
 * The cell's markdown, in the shape above; empty parts leave no trace. The conclusion's label is interface text: the
 * caller gives it from the locales (`plan.fromNote.conclusionLabel`) for the cell's language.
 */
export function assembleNotePlanMarkdown(
  node: NotePlanNodeFilling, conclusionLabel: (language: NotePlanLanguage) => string, requested?: AppLocale,
): string {
  const parts: string[] = [];
  // An entry that ends on a colon before the list would be read as a heading (`normalizePlanPointHeadings`).
  const entry = clean(node.entry).replace(/[:：]$/, '.');
  if (entry) parts.push(entry);
  node.refs.map(verse).filter(Boolean).forEach((ref) => parts.push(`*${ref}*`));
  let number = 0;
  for (const step of node.steps) {
    const markdown = stepMarkdown(step, number + 1);
    if (!markdown) continue;
    number += 1;
    parts.push(markdown);
  }
  const table = node.table && tableMarkdown(node.table);
  if (table) parts.push(table);
  const conclusion = clean(node.conclusion);
  if (conclusion) {
    const language = [entry, ...node.steps.map((step) => `${step.title} ${step.thoughts.join(' ')}`), conclusion].join(' ');
    parts.push(`**${conclusionLabel(noteLanguage(language, requested))}:** ${conclusion}`);
  }
  return parts.join('\n\n');
}

/**
 * A verse line's reference is what the app's own reader takes for one — «Ин. 3:16», «John 3.16», «Пс. 23» — and
 * «*Начать в 10:30*» is not. «Ref: words»: the words begin after a colon that a digit does not follow.
 */
const isReference = (text: string): boolean => {
  const line = text.trim();
  // The reference ends at one of its colons, or is the whole line: «John 3:16: 16 For God…» reads «John 3:16».
  const heads = [...line.matchAll(/:/g)].map((match) => line.slice(0, match.index)).concat(line);
  return heads.some((head) => /\d/.test(head) && parseReferenceText(head.trim()) !== null);
};

const elements = (node: Root | Element): Element[] => (node.children as { type: string }[]).filter((child) => child.type === 'element') as Element[];
const plainText = (node: Root | Element | Text): string => node.type === 'text' ? node.value : node.children.map((child) => (child.type === 'element' || child.type === 'text' ? plainText(child) : '')).join('');
const isVerseParagraph = (node: Element): boolean => {
  if (node.tagName !== 'p') return false;
  const parts = node.children.filter((child) => !(child.type === 'text' && !child.value.trim()));
  return parts.length === 1 && parts[0].type === 'element' && parts[0].tagName === 'em' && isReference(plainText(parts[0]));
};
const range = (node: Element): [number, number] | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : [start, end];
};

/**
 * A step is found by its whole name, never by its place: a model that returns fewer steps must not shift verses. Names
 * compare as the eye reads them — whole, with their numbers and punctuation («2. Молитва» is not «Молитва»).
 */
const displayKey = (text: string): string => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
/** The answer's name as read: a bold wrapping around the whole of it is markup, any other mark is part of it. */
const stepKey = (title: string): string => displayKey(title.trim().replace(/^(\*\*|__)(.+)\1$/, '$2'));

/** The first thing in a block that is not blank space. */
const leading = (block: Element) => block.children.find((child) => !(child.type === 'text' && !child.value.trim()));

/** A step's name: the bold run its first block BEGINS with (the assembler's `**name** — gist`); none, no name. */
function itemKey(item: Element): string {
  const first = leading(item);
  if (!first || first.type !== 'element') return '';
  const strong = first.tagName === 'strong' ? first : first.tagName === 'p' ? leading(first) : undefined;
  return strong?.type === 'element' && strong.tagName === 'strong' ? displayKey(plainText(strong)) : '';
}

/** A paragraph that begins with a bold run: a caption, a step's name, the conclusion. */
const startsWithBold = (element: Element): boolean => {
  const first = leading(element);
  return first?.type === 'element' && first.tagName === 'strong';
};

/** A paragraph that names a Scripture place but is not a Markdown verse line: a verse the code cannot move. */
const isOtherVerse = (block: Element): boolean => block.tagName === 'p' && !isVerseParagraph(block) && isReference(plainText(block));

/**
 * The edits of one source cell. They stay inside the preacher's own Markdown verse lines (`*…*` or `_…_` on one line —
 * authored HTML is never edited) or right after a step's name; no line, separator or neighbour is touched.
 */
function cellEditor(current: string) {
  const edits: { start: number; end: number; text: string }[] = [];
  const lineStart = (at: number): number => Math.max(current.lastIndexOf('\n', at - 1), current.lastIndexOf('\r', at - 1)) + 1;
  const lineEnding = (at: number): string => current.slice(at).match(/\r\n|\r|\n/)?.[0] ?? '\n';
  // The run before a block on its line, as blank space: under "1. " the content sits three spaces in.
  const indentOf = (at: number): string => current.slice(lineStart(at), at).replace(/\S/g, ' ');
  const markdownVerse = (paragraph: Element): [number, number] | null => {
    const span = range(paragraph);
    return span && /^([*_])[^*_\r\n]+\1$/.test(current.slice(span[0], span[1])) ? span : null;
  };

  return {
    /**
     * Verses replaced pair by pair in their own places; extra new ones follow the last old one; an old one left over is
     * emptied in place. Every verse of the group must be a Markdown verse line, or pairs would shift: then none moves.
     */
    replaceVerses(paragraphs: Element[], refs: string[]): boolean {
      const spans = paragraphs.map(markdownVerse);
      if (!spans.length || spans.some((span) => !span)) return false;
      (spans as [number, number][]).forEach(([start, end], index) => {
        const last = index === spans.length - 1;
        const text = last && index < refs.length - 1
          ? refs.slice(index).map((ref) => `*${ref}*`).join(`${lineEnding(end)}${lineEnding(end)}${indentOf(start)}`)
          : index < refs.length ? `*${refs[index]}*` : '';
        edits.push({ start, end, text });
      });
      return true;
    },
    /**
     * New verses right under a step's name — only when the name line is a paragraph of its own (`**…** — gist`), or,
     * in a tight list, the whole of its item.
     */
    insertUnder(item: Element, refs: string[]): boolean {
      const blocks = elements(item);
      const name = blocks[0];
      const itemEnd = range(item)?.[1];
      const nameStart = name ? range(name)?.[0] : undefined;
      const span: [number, number] | null = name?.tagName === 'p' ? range(name)
        : name?.tagName === 'strong' && blocks.length === 1 && nameStart !== undefined && itemEnd !== undefined ? [nameStart, itemEnd] : null;
      const source = span ? current.slice(span[0], span[1]) : '';
      if (!span || !/^\*\*/.test(source) || /[\r\n]/.test(source)) return false;
      const eol = lineEnding(span[1]);
      const indent = indentOf(span[0]);
      edits.push({ start: span[1], end: span[1], text: refs.map((ref) => `${eol}${eol}${indent}*${ref}*`).join('') });
      return true;
    },
    /** Disjoint ranges applied from the end, so every offset stays true; nothing to edit — the very same string. */
    apply(): string {
      return edits
        .sort((a, b) => b.start - a.start)
        .reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), current);
    },
  };
}
type CellEditor = ReturnType<typeof cellEditor>;

const verseLines = (refs: string[]): string[] => refs.map(verse).filter(Boolean);

/** Each answered step goes to the one item of the cell's top-level lists whose whole name it carries; returns misses. */
function placeStepVerses(editor: CellEditor, lists: Element[], steps: NotePlanStep[]): number {
  const items = lists.flatMap((list) => elements(list).filter((element) => element.tagName === 'li'));
  const keys = items.map(itemKey);
  let missed = 0;
  for (const step of steps.filter((answer) => verseLines(answer.refs).length)) {
    const key = stepKey(step.title);
    const at = keys.indexOf(key);
    // A name two items share, or two answer steps share, is nobody's.
    const sure = key && at >= 0 && keys.lastIndexOf(key) === at && steps.filter((other) => stepKey(other.title) === key).length === 1;
    const blocks = sure ? elements(items[at]) : [];
    const verses = blocks.filter(isVerseParagraph);
    const refs = verseLines(step.refs);
    // A verse written otherwise among them («John 3:16: …» without italics) would shift the pairs: none moves.
    const placed = sure && !blocks.slice(1).some(isOtherVerse)
      && (verses.length ? editor.replaceVerses(verses, refs) : editor.insertUnder(items[at], refs));
    if (!placed) missed += 1;
  }
  return missed;
}

/**
 * A cell written before steps existed: cues, then its verses in one closing run — they take the new verses in order,
 * where the old ones stood. Under headings, captioned parts («**Адам:** …», «**Руфь**») or verses between other blocks,
 * the order of verses says nothing about where a new one belongs: such a cell is left as it is.
 */
function placeOldCellVerses(editor: CellEditor, top: Element[], refs: string[]): boolean {
  const captioned = top.some((element) => /^h[1-6]$/.test(element.tagName) || isOtherVerse(element)
    || (element.tagName === 'p' && startsWithBold(element) && !plainText(element).trim().startsWith('→')));
  const firstVerse = top.findIndex(isVerseParagraph);
  const scattered = firstVerse >= 0 && top.slice(firstVerse).some((element) => !isVerseParagraph(element));
  return !captioned && !scattered && editor.replaceVerses(top.filter(isVerseParagraph), refs);
}

/**
 * The point's own verses as the assembler writes them: at the top, after one opening paragraph at most, in one unbroken
 * run that the steps, a table, the conclusion or the cell's end follows. Anything else is not for sure the point's.
 */
function pointRun(top: Element[]): Element[] {
  const first = top[0];
  const opening = first?.tagName === 'p' && !isVerseParagraph(first) && !isOtherVerse(first) && !startsWithBold(first) ? 1 : 0;
  let end = opening;
  while (end < top.length && isVerseParagraph(top[end])) end += 1;
  const next = top[end];
  const closes = !next || next.tagName === 'ol' || next.tagName === 'table' || (next.tagName === 'p' && startsWithBold(next));
  // A verse written otherwise above the steps («**John 3:18: …**») would be left beside its new copy: none moves.
  const list = top.findIndex((element) => element.tagName === 'ol');
  const other = top.slice(0, list < 0 ? top.length : list).some(isOtherVerse);
  return end > opening && closes && !other ? top.slice(opening, end) : [];
}

function placeIn(current: string, node: Pick<NotePlanNodeFilling, 'refs' | 'steps' | 'table'>): { text: string; unplaced: number } {
  const top = elements(readMarkdownHtml(current));
  const lists = top.filter((element) => element.tagName === 'ol');
  const editor = cellEditor(current);
  const pointRefs = verseLines(node.refs);
  const stepRefs = node.steps.flatMap((step) => verseLines(step.refs));
  const run = pointRun(top);
  // Verses an answer puts in a table have no verse line to stand in.
  let unplaced = node.table?.rows.some((row) => [row.label, ...row.cells].some(isReference)) ? 1 : 0;

  if (lists.length) {
    if (pointRefs.length && (!run.length || !editor.replaceVerses(run, pointRefs))) unplaced += 1;
    unplaced += placeStepVerses(editor, lists, node.steps);
  } else if (pointRefs.length && !stepRefs.length && run.length) {
    if (!editor.replaceVerses(run, pointRefs)) unplaced += 1;
  } else {
    const refs = [...pointRefs, ...stepRefs];
    if (refs.length && !placeOldCellVerses(editor, top, refs)) unplaced += 1;
  }
  return { text: editor.apply(), unplaced };
}

/**
 * A references-only revision of a cell in the shape above. Only verses change, and only where the Markdown itself says
 * for sure where they belong: the verse paragraphs of a top-level list item whose whole name the answer gives, and the
 * point's own verses at the top. Every other byte — the preacher's words, indentation, blank lines, line endings, code,
 * HTML, tables, a verse after the list — stays. A step that had no verse gets one right under its name. What could not
 * be placed is counted, so the preacher is told; a cell the reader cannot even parse comes back as it was, counted.
 */
export function placeNotePlanReferences(current: string, node: Pick<NotePlanNodeFilling, 'refs' | 'steps' | 'table'>): { text: string; unplaced: number } {
  try {
    return placeIn(current, node);
  } catch {
    return { text: current, unplaced: 1 };
  }
}

/** The revised cell alone (see `placeNotePlanReferences`). */
export function replaceNotePlanReferences(current: string, node: Pick<NotePlanNodeFilling, 'refs' | 'steps'> & { table?: NotePlanTable | null }): string {
  return placeNotePlanReferences(current, { table: null, ...node }).text;
}
