import { act, renderHook } from '@testing-library/react';

import { useVerseCopy, type PassageLimit } from '@/components/bible/verseCopy/useVerseCopy';

import type { BookText } from '@/utils/bibleText';

/*
 * THE VERSES OF A COMMENT ARE CHOSEN FOR WHAT ITS WINDOW SAYS IT IS (Codex review of the visual pass, 2026-11-07): a new comment
 * on 1:1–2, switched to «Комментарий», stretched by «Изменить стихи» to 1:4 took the paragraph over 1:3–6 whole — the
 * paragraphs' rule is a paragraph's. Chosen as a paragraph, or from a door with no window yet, the rule stands as before.
 */
const book: BookText = { id: 'Ruth', chapters: [['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']] };
const v = (verse: number) => ({ chapter: 1, verse });
// The paragraphs' rule as the reader keeps it (`useCommentLimit`), cut down: a paragraph's, so a run into 1:3–6 takes that
// paragraph whole unless the window says it is a comment. What decides is the kind the choice hands it.
const limitComment: PassageLimit = (verses, _end, _before, asParagraph) => (asParagraph !== false && verses.some((at) => at.verse >= 3 && at.verse <= 6)
  ? { verses: [1, 2, 3, 4, 5, 6].map(v), said: 'took' }
  : { verses });

const picker = () => renderHook(() => useVerseCopy({ textRef: { current: document.createElement('article') }, text: book, bible: 'rst', bookId: 'Ruth', enabled: true, limitComment }));
const chosen = (verses: readonly { verse: number }[] | null) => (verses ?? []).map((at) => at.verse).sort((a, b) => a - b);

describe('the verses of a comment, chosen again', () => {
  it.each([
    ['a comment', false, [1, 2, 3, 4]],
    ['a paragraph', true, [1, 2, 3, 4, 5, 6]],
    ['a door with no window yet', undefined, [1, 2, 3, 4, 5, 6]],
  ])('keep the paragraphs\' rule only for what is one: %s', (_, asParagraph, expected) => {
    const { result } = picker();
    act(() => result.current.startPassage(v(1), v(2), 'comment', asParagraph as boolean | undefined));
    act(() => result.current.toggle(v(4)));
    expect(chosen(result.current.picked)).toEqual(expected);
  });
});

// The rule itself (`useCommentLimit`), on a paragraph over 1:3–6 and a written comment on 1:1–2 that is no paragraph (Codex
// review r2, 2026-11-07): switched to a paragraph in its window, its verses keep the rule before it is saved as one.
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe('the paragraphs\' rule while a comment\'s verses are chosen', () => {
  const { layParagraphs } = jest.requireActual('@/components/bible/commentParagraphs') as typeof import('@/components/bible/commentParagraphs');
  const { useCommentLimit } = jest.requireActual('@/components/bible/ReaderCommentDialog') as typeof import('@/components/bible/ReaderCommentDialog');
  const { laid } = layParagraphs([{ id: 'wives', passage: { chapter: 1, fromVerse: 3, toChapter: 1, toVerse: 6 }, paragraph: true }]);
  const limit = () => renderHook(() => useCommentLimit({ text: book, laid, bodyOf: () => 'Жёны', commenting: { kind: 'edit', id: 'kids' } })).result.current;
  const stretched = [1, 2, 3, 4].map(v);

  it.each([
    ['switched to a paragraph', true, [1, 2, 3, 4, 5, 6]],
    ['a comment', false, [1, 2, 3, 4]],
    ['no window: as it is laid — not a paragraph', undefined, [1, 2, 3, 4]],
  ])('%s', (_, asParagraph, expected) => {
    expect(chosen(limit()(stretched, 'last', [1, 2].map(v), asParagraph as boolean | undefined).verses)).toEqual(expected);
  });
});
