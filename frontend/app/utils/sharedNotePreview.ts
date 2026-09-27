import { formatScriptureReferences } from '@/utils/scriptureReference';
import { studyNoteOwnName } from '@/utils/studyNoteUtils';

import type { AppLocale } from '@/utils/appLocale';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * WHAT A SHARED NOTE'S LINK SAYS BEFORE ANYONE OPENS IT — the card a messenger draws.
 *
 * Telegram and Viber read the page's tags, not the page, so the note has to be named on the
 * server. The name is the one every screen gives a note (`studyNoteOwnName`: its title, else its
 * first passage) and, only here, the first line of the text after that — because "Untitled note"
 * gives nobody a reason to open the link. The teaser is the author's own words: the start of the
 * text with the Markdown taken off, since a messenger would print `**` literally.
 */
export interface SharedNotePreviewSource {
  title?: string;
  content: string;
  scriptureRefs: readonly ScriptureRefShape[];
  type: 'note' | 'question';
}

/** Words the caller passes in, because this module speaks no language. */
export interface SharedNotePreviewWords {
  note: string;
  question: string;
  untitled: string;
}

export interface SharedNotePreview {
  title: string;
  description?: string;
  /** Passages to show under the title — never the one that already is the title. */
  passages?: string;
  kind: string;
}

const TITLE_LIMIT = 90;
const DESCRIPTION_LIMIT = 200;
const PASSAGE_LIMIT = 3;

// An unclosed fence runs to the end of the text; a tag is `<b>` or `</p>`, not "5 < 7 > 3".
const FENCE = /```[\s\S]*?(?:```|$)/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const THEMATIC_BREAK = /^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const HEADING = /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/;
const LINE_MARKER = /^[ \t]{0,3}(#{1,6}(?:[ \t]+|$)|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/;
const EMPHASIS = /[*_~`]+/g;
const ENDS_LIKE_A_SENTENCE = /[.!?…:;,)»"']$/;

/** The text as a reader would say it: paragraphs of plain lines. A heading is a paragraph of its own. */
function plainParagraphs(markdown: string): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current);
    current = [];
  };
  const cleaned = markdown.replace(FENCE, ' ').replace(IMAGE, ' ').replace(LINK, '$1').replace(TAG, ' ');
  for (const raw of cleaned.split('\n')) {
    if (THEMATIC_BREAK.test(raw)) {
      flush();
      continue;
    }
    const line = raw.replace(LINE_MARKER, '').replace(EMPHASIS, '').replace(/\s+/g, ' ').trim();
    if (!line) {
      flush();
    } else if (HEADING.test(raw)) {
      flush();
      paragraphs.push([line]);
    } else {
      current.push(line);
    }
  }
  flush();
  return paragraphs;
}

/** Paragraphs read as one line: a heading or a line without a full stop gets one before the next. */
function joinAsProse(paragraphs: string[][]): string {
  return paragraphs
    .map((lines) => lines.join(' '))
    .reduce((text, paragraph) => {
      if (!text) return paragraph;
      return `${text}${ENDS_LIKE_A_SENTENCE.test(text) ? '' : '.'} ${paragraph}`;
    }, '');
}

/** What a person sees as one character — so a cut never leaves half an emoji behind. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/** Cut on a word boundary; a word longer than the room itself is cut at a grapheme. */
function clip(text: string, limit: number): string {
  const units = graphemes(text);
  if (units.length <= limit) return text;
  const cut = units.slice(0, limit).join('');
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,.;:—–-]+$/, '')}…`;
}

/**
 * Text the bundled fonts can draw on their own: Latin, Cyrillic, digits and punctuation. Emoji
 * and other scripts are fetched from the network at render time; a card drawn without them is
 * the fallback when that fetch fails.
 */
export function cardSafeText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?|‍/gu, '')
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSharedNotePreview(
  note: SharedNotePreviewSource,
  locale: AppLocale,
  words: SharedNotePreviewWords
): SharedNotePreview {
  const face = { locale, style: 'long' as const };
  const paragraphs = plainParagraphs(note.content);
  const kind = note.type === 'question' ? words.question : words.note;
  const ownTitle = note.title?.trim();
  const ownName = studyNoteOwnName(note, locale);

  let title: string;
  let body = paragraphs;
  // Under the note's own title the passages are a subtitle; under a title that IS the first
  // passage they start from the second one.
  let passages = formatScriptureReferences(ownTitle ? note.scriptureRefs : note.scriptureRefs.slice(1), {
    ...face,
    limit: PASSAGE_LIMIT,
  });

  if (ownName) {
    title = ownName;
  } else if (paragraphs.length > 0) {
    const [firstLine, ...restOfFirst] = paragraphs[0];
    title = firstLine;
    body = restOfFirst.length > 0 ? [restOfFirst, ...paragraphs.slice(1)] : paragraphs.slice(1);
    passages = undefined;
  } else {
    title = words.untitled;
    passages = undefined;
  }

  const teaser = joinAsProse(body);
  return {
    title: clip(title, TITLE_LIMIT),
    ...(teaser ? { description: clip(teaser, DESCRIPTION_LIMIT) } : {}),
    ...(passages ? { passages } : {}),
    kind,
  };
}
