import { render } from '@testing-library/react';

import { layParagraphs } from '@/components/bible/commentParagraphs';
import { ParagraphLines } from '@/components/bible/ParagraphLines';

/*
 * THE LINE BESIDE THE PARAGRAPHS (phase 9; Codex review r3: the reader's tests stayed green with the line drawn as
 * nothing). Headings and rows measured by hand, 40 px a row: the drawing is checked by what it is made of.
 */
const rect = (top: number, bottom: number, left = 40) => ({ top, bottom, left, right: left + 200, width: 200, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;
const run = (fromVerse: number, toVerse: number) => ({ chapter: 1, fromVerse, toChapter: 1, toVerse });

function card(verses: number[], heads: string[]) {
  const root = document.createElement('article');
  root.getBoundingClientRect = () => rect(0, 1000, 0);
  heads.forEach((id) => {
    const head = document.createElement('div');
    head.dataset.paragraphHead = id;
    head.innerHTML = '<button type="button">sign</button>';
    root.append(head);
  });
  verses.forEach((verse) => {
    const row = document.createElement('div');
    row.dataset.verse = `1:${verse}`;
    row.getBoundingClientRect = () => rect(verse * 40, verse * 40 + 40);
    root.append(row);
  });
  root.querySelectorAll<HTMLElement>('[data-paragraph-head] button').forEach((sign) => { sign.getBoundingClientRect = () => rect(0, 20); });
  document.body.append(root);
  return root;
}
const kinds = () => [...document.querySelectorAll<HTMLElement>('[data-piece]')].map((piece) => piece.dataset.piece).sort();

afterEach(() => { document.body.innerHTML = ''; });

describe('the line beside the paragraphs', () => {
  it('draws an outer paragraph as a ring to an end dot, one inside it as a station, a thicker line and its own end dot', () => {
    const { laid } = layParagraphs([{ id: 'outer', passage: run(1, 6) }, { id: 'inner', passage: run(2, 4) }]);
    const root = card([1, 2, 3, 4, 5, 6], ['outer', 'inner']);
    render(<ParagraphLines root={{ current: root }} laid={laid} />);
    expect(kinds()).toEqual(['end', 'end', 'line', 'ring', 'station', 'thick']);
  });

  it('draws no end dot where the last verse is not on the page, and no ring where the heading is not', () => {
    const { laid } = layParagraphs([{ id: 'outer', passage: run(1, 6) }]);
    render(<ParagraphLines root={{ current: card([1, 2, 3], []) }} laid={laid} />);
    expect(kinds()).toEqual(['line']);
  });

  it('draws nothing when no paragraph stands on the text', () => {
    render(<ParagraphLines root={{ current: card([1, 2], []) }} laid={[]} />);
    expect(document.querySelector('[data-testid="paragraph-lines"]')).toBeNull();
  });
});
