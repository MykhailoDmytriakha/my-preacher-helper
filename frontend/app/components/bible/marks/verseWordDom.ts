import type { WordAt } from '@/utils/bibleMarks';

/*
 * THE WORDS OF A DRAWN VERSE — where a mark's words stand on the page and which word a finger is on.
 * The ribbon draws a verse's words inside `[data-verse-text]` of its row `[data-verse="chapter:verse"]`
 * (`BookRibbon.tsx`). The words are counted as `verseWords` counts them: runs of non-space, a line
 * break being a space — so the n-th word here is the n-th word a mark was saved with.
 */
export const VERSE_TEXT_ATTRIBUTE = 'data-verse-text';
const VERSE_ROW = '[data-verse]';

type Piece = { node: Text; start: number };
export type VerseTextMap = { pieces: Piece[]; words: Array<[number, number]> };

export function mapVerseText(container: Element): VerseTextMap {
  const pieces: Piece[] = [];
  let text = '';
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        pieces.push({ node: child as Text, start: text.length });
        text += (child as Text).data;
      } else if (child.nodeName === 'BR') {
        text += '\n';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    });
  };
  walk(container);
  const words: Array<[number, number]> = [];
  for (const match of text.matchAll(/\S+/g)) words.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  return { pieces, words };
}

/** The word at a character of the verse; in the space between words, the word before it. */
export function wordIndexAt(map: VerseTextMap, char: number): number | null {
  if (map.words.length === 0) return null;
  let found = 0;
  for (let index = 0; index < map.words.length; index += 1) {
    if (map.words[index][0] <= char) found = index;
    else break;
  }
  return found;
}

function pointAt(map: VerseTextMap, char: number): { node: Text; offset: number } | null {
  for (let index = map.pieces.length - 1; index >= 0; index -= 1) {
    const piece = map.pieces[index];
    if (piece.start <= char) return { node: piece.node, offset: Math.min(char - piece.start, piece.node.data.length) };
  }
  return null;
}

/** The words `[first, last]` of a verse as a range of the page, for drawing a mark over them. */
export function wordsRange(map: VerseTextMap, first: number, last: number): Range | null {
  const from = map.words[first];
  const to = map.words[Math.min(last, map.words.length - 1)];
  if (!from || !to) return null;
  const start = pointAt(map, from[0]);
  const end = pointAt(map, to[1]);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as CaretDocument;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/** When the browser gives no caret there: the word whose box holds the point, or the nearest on its line. */
function wordByBoxes(container: Element, map: VerseTextMap, x: number, y: number): number | null {
  let best: { index: number; distance: number } | null = null;
  map.words.forEach((_, index) => {
    const range = wordsRange(map, index, index);
    if (!range) return;
    for (const box of Array.from(range.getClientRects())) {
      if (y < box.top || y > box.bottom) continue;
      const distance = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
      if (!best || distance < best.distance) best = { index, distance };
    }
  });
  return (best as { index: number } | null)?.index ?? null;
}

/** The word under a point of the screen, if the point is on a verse's text. */
export function wordAtPoint(root: Element, x: number, y: number): WordAt | null {
  const caret = caretAt(x, y);
  const caretElement = caret ? (caret.node.nodeType === Node.TEXT_NODE ? caret.node.parentElement : caret.node as Element) : null;
  let container = caretElement?.closest(`[${VERSE_TEXT_ATTRIBUTE}]`) ?? null;
  if (!container || !root.contains(container)) {
    // No caret, or a caret outside the text (a margin, the verse number): the row under the point decides.
    const row = document.elementFromPoint(x, y)?.closest(VERSE_ROW);
    container = row && root.contains(row) ? row.querySelector(`[${VERSE_TEXT_ATTRIBUTE}]`) : null;
    if (!container) return null;
    const verse = container.closest(VERSE_ROW)?.getAttribute('data-verse');
    const index = wordByBoxes(container, mapVerseText(container), x, y);
    return verse && index !== null ? { verse, index } : null;
  }
  const verse = container.closest(VERSE_ROW)?.getAttribute('data-verse');
  if (!verse) return null;
  const map = mapVerseText(container);
  const piece = caret && caret.node.nodeType === Node.TEXT_NODE ? map.pieces.find((item) => item.node === caret.node) : undefined;
  const index = piece ? wordIndexAt(map, piece.start + caret!.offset) : wordByBoxes(container, map, x, y);
  return index === null ? null : { verse, index };
}
