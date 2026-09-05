/**
 * HOW MANY SCRATCH NOTES A STUDY NOTE SHOULD YIELD — a corridor, not a number.
 *
 * The count of atomic scratch notes is derived from the note (one per cornerstone
 * claim), so nothing here fixes it. What this gives is the EXPECTATION the length
 * justifies: roughly one cornerstone claim per 250–400 words of study text.
 *
 * THE NOTE IS MEASURED IN THE UNITS A PERSON CAN SEE — words and paragraphs, never
 * characters. A character count is a number nobody can picture: told "36,719 characters"
 * a preacher cannot tell whether that is long, and cannot check the arithmetic that
 * follows from it. Words are also the honest unit across languages: the same idea takes
 * noticeably more characters in Russian than in English, so a character-based corridor
 * silently promised fewer claims for the same amount of thought.
 *
 * The same numbers are shown to the person before the cut ("expecting about 15–24"),
 * explained to them in those units, and handed to the model as guidance — one function,
 * so what the screen promised and what the cutter was told never disagree.
 */
export interface ScratchCountCorridor {
  min: number;
  max: number;
}

/** What the note is, said in units the reader can check with their own eyes. */
export interface NoteCutMeasure {
  words: number;
  paragraphs: number;
  corridor: ScratchCountCorridor;
}

/** Sparse prose — one cornerstone claim carries this many words. */
export const WORDS_PER_CLAIM_LOW = 400;
/** Dense prose — a claim every this many words. */
export const WORDS_PER_CLAIM_HIGH = 250;

const CODE_FENCE = /```[\s\S]*?```/g;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const INLINE_CODE = /`[^`]*`/g;
const HTML_TAG = /<[^>]+>/g;
const HEADING_LINE = /^\s*#{1,6}\s/;
/** A token counts as a word only if it carries a letter or a digit — "—" and "##" do not. */
const CARRIES_WORD = /[\p{L}\p{N}]/u;

/**
 * Markdown stripped down to what a person actually reads: link text without its URL,
 * no code, no tags. Markup glued to a word ("**claim**") is left alone — it does not
 * change how many words there are.
 */
function readableText(content: string): string {
  return content
    .replace(CODE_FENCE, ' ')
    .replace(MARKDOWN_IMAGE, ' ')
    .replace(MARKDOWN_LINK, '$1')
    .replace(INLINE_CODE, ' ')
    .replace(HTML_TAG, ' ');
}

export function countWords(content: string): number {
  if (!content) return 0;
  return readableText(content)
    .split(/\s+/)
    .filter((token) => CARRIES_WORD.test(token)).length;
}

/**
 * Paragraphs as the editor writes them: blocks separated by a blank line. A heading is
 * not a paragraph — it names one — so a block that is nothing but headings is skipped.
 */
export function countParagraphs(content: string): number {
  if (!content) return 0;
  return readableText(content)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => {
      if (!CARRIES_WORD.test(block)) return false;
      return !block.split('\n').every((line) => HEADING_LINE.test(line) || line.trim().length === 0);
    }).length;
}

function corridorFromWords(words: number): ScratchCountCorridor {
  // Nothing to read means nothing to promise — an empty note is not "expecting 1–2".
  if (words <= 0) return { min: 0, max: 0 };
  const min = Math.max(1, Math.ceil(words / WORDS_PER_CLAIM_LOW));
  const max = Math.max(min + 1, Math.ceil(words / WORDS_PER_CLAIM_HIGH));
  return { min, max };
}

/** Words, paragraphs and the corridor they justify — measured in one pass. */
export function measureNoteForCut(content: string): NoteCutMeasure {
  const words = countWords(content);
  return { words, paragraphs: countParagraphs(content), corridor: corridorFromWords(words) };
}

export function expectedScratchCountCorridor(content: string): ScratchCountCorridor {
  return corridorFromWords(countWords(content));
}
