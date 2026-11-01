import { fitCommentPassage, isParagraph, layParagraphs, paragraphRefusal, spanOf, versePosition } from '@/components/bible/commentParagraphs';

import type { BookText } from '@/utils/bibleText';
import type { Passage } from '@/utils/scriptureReferenceNumbering';

const at = (chapter: number, fromVerse: number, toVerse = fromVerse, toChapter = chapter): Passage => ({ chapter, fromVerse, toChapter, toVerse });
const comment = (id: string, passage: Passage) => ({ id, passage });

describe('comment paragraphs (case 2026-10-12-block-diagram, phase 9)', () => {
  it('takes a comment on more than one verse for a paragraph, and one on a verse or a whole chapter for none', () => {
    expect(isParagraph(at(1, 3, 6))).toBe(true);
    expect(isParagraph(at(4, 31, 2, 5))).toBe(true);
    expect(isParagraph(at(1, 15))).toBe(false);
    expect(isParagraph({ chapter: 2, toChapter: 3 })).toBe(false);
    expect(spanOf(at(4, 31, 2, 5))).toEqual({ from: versePosition(4, 31), to: versePosition(5, 2) });
  });

  it('lays an outer paragraph and the paragraphs inside it, outer first, with how deep each lies', () => {
    const { laid, apart } = layParagraphs([
      comment('father', at(1, 3, 6)),
      comment('son', at(1, 7, 12)),
      comment('eulogy', at(1, 3, 14)),
      comment('across', at(4, 31, 2, 5)),
    ]);
    expect(laid.map(({ id, first, last, level, inner }) => ({ id, first, last, level, inner }))).toEqual([
      { id: 'eulogy', first: '1:3', last: '1:14', level: 0, inner: true },
      { id: 'father', first: '1:3', last: '1:6', level: 1, inner: false },
      { id: 'son', first: '1:7', last: '1:12', level: 1, inner: false },
      { id: 'across', first: '4:31', last: '5:2', level: 0, inner: false },
    ]);
    expect([...apart]).toEqual([]);
  });

  it('keeps a comment that crosses a paragraph, lies three deep or repeats one apart — drawn under its verse, not lost', () => {
    const { laid, apart } = layParagraphs([
      comment('eulogy', at(1, 3, 14)),
      comment('son', at(1, 7, 12)),
      comment('crossing', at(1, 10, 16)),
      comment('third', at(1, 8, 9)),
      comment('again', at(1, 7, 12)),
    ]);
    expect(laid.map((paragraph) => paragraph.id)).toEqual(['eulogy', 'son']);
    expect([...apart].sort()).toEqual(['again', 'crossing', 'third']);
  });

  it('says why a run may not be a paragraph among those laid', () => {
    const { laid } = layParagraphs([comment('eulogy', at(1, 3, 14)), comment('son', at(1, 7, 12))]);
    const span = (from: number, to: number) => ({ from: versePosition(1, from), to: versePosition(1, to) });
    expect(paragraphRefusal(span(13, 16), laid)).toEqual({ why: 'cross', with: 'eulogy' });
    expect(paragraphRefusal(span(7, 12), laid)).toEqual({ why: 'same', with: 'son' });
    expect(paragraphRefusal(span(8, 9), laid)).toEqual({ why: 'deep' });
    expect(paragraphRefusal(span(13, 14), laid)).toBeNull();
    expect(paragraphRefusal(span(15, 23), laid)).toBeNull();
    expect(paragraphRefusal(span(1, 14), laid)).toEqual({ why: 'deep' });
  });
});

describe('the verses chosen for a comment keep the paragraphs\' rule (fitCommentPassage)', () => {
  // Two chapters of 23 and 5 verses: enough for an outer paragraph, one inside it and a run past them.
  const text = { id: 'Ephesians', chapters: [Array.from({ length: 23 }, () => 'v'), Array.from({ length: 5 }, () => 'v')] } as unknown as BookText;
  const v = (chapter: number, verse: number) => ({ chapter, verse });
  const run = (from: number, to: number, chapter = 1) => Array.from({ length: to - from + 1 }, (_, i) => v(chapter, from + i));
  const { laid } = layParagraphs([comment('eulogy', at(1, 3, 14)), comment('son', at(1, 7, 12))]);

  it('lets a run that crosses nothing stand, and one verse always', () => {
    expect(fitCommentPassage(text, laid, run(15, 23), 'last', run(15, 20))).toEqual({ verses: run(15, 23) });
    expect(fitCommentPassage(text, laid, [v(1, 9)], 'first', run(8, 9))).toEqual({ verses: [v(1, 9)] });
  });

  it('takes a paragraph whole when the press went into it, where the result may stand — and not where it would lie three deep', () => {
    const lone = layParagraphs([comment('eulogy', at(1, 3, 14))]).laid;
    expect(fitCommentPassage(text, lone, run(13, 23), 'first', run(15, 23))).toEqual({ verses: run(3, 23), said: { why: 'took', with: 'eulogy' } });
    // With 7–12 inside the eulogy, taking it whole would make three levels: the first verse stops past it instead.
    expect(fitCommentPassage(text, laid, run(13, 23), 'first', run(15, 23))).toEqual({ verses: run(15, 23), said: { why: 'cross', with: 'eulogy' } });
  });

  it('stops the end just moved at the last verse it may reach — a third level, or a paragraph it would cross', () => {
    expect(fitCommentPassage(text, laid, run(8, 9), 'last', [v(1, 8)])).toEqual({ verses: [v(1, 8)], said: { why: 'deep' } });
    const across = fitCommentPassage(text, laid, run(13, 16), 'last', run(13, 14));
    expect(across.verses).toEqual(run(13, 14));
    expect(across.said).toEqual({ why: 'cross', with: 'eulogy' });
  });

  it('does not take another paragraph\'s very run, and leaves out the comment whose verses are chosen again', () => {
    expect(fitCommentPassage(text, laid, run(7, 12), 'last', run(7, 11))).toEqual({ verses: run(7, 11), said: { why: 'same', with: 'son' } });
    expect(fitCommentPassage(text, laid, run(7, 13), 'last', run(7, 12), 'son')).toEqual({ verses: run(7, 13) });
  });
});

describe('a comment that falls into two pieces in the Bible read (Codex review r1)', () => {
  it('lays each piece on its own, and leaves every piece of the comment out when its verses are chosen again', () => {
    const { laid } = layParagraphs([
      { id: 'c:14', owner: 'c', passage: at(14, 24, 26) },
      { id: 'c:16', owner: 'c', passage: at(16, 24, 25) },
    ]);
    expect(laid.map(({ id, owner }) => ({ id, owner }))).toEqual([{ id: 'c:14', owner: 'c' }, { id: 'c:16', owner: 'c' }]);
    const text = { id: 'Romans', chapters: Array.from({ length: 16 }, () => Array.from({ length: 30 }, () => 'v')) } as unknown as BookText;
    // 14:25–28 crosses the comment's own piece 14:24–26: left out, it stands; counted, it would be stopped at its edge.
    const verses = Array.from({ length: 4 }, (_, i) => ({ chapter: 14, verse: 25 + i }));
    expect(fitCommentPassage(text, laid, verses, 'last', verses.slice(0, 3), 'c')).toEqual({ verses });
  });
});
