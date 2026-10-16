import { fireEvent, render, screen, within } from '@testing-library/react';

import { BookRibbon, type RibbonSigns } from '@/components/bible/BookRibbon';
import { MarkedElsewhereSheet } from '@/components/bible/marks/MarkedElsewhereSheet';
import { markedElsewhere, versesElsewhere } from '@/utils/bibleMarks';
import { fetchBookText, type BookText } from '@/utils/bibleText';

jest.mock('@/utils/bibleText', () => ({
  ...jest.requireActual('@/utils/bibleText'),
  fetchBookText: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { verse?: number }) => (options?.verse ? `${key}:${options.verse}` : key) }),
}));

/*
 * 2.9.3: a verse marked in another Bible carries a sign here, and the sign opens the verse there whole,
 * in its own words, painted as it is painted there.
 */
const synodal: BookText = { id: 'Isaiah', chapters: [[], [], [], ['Уповайте на Господа вовеки, ибо Господь Бог есть твердыня вечная:']] };

describe('a verse marked in another Bible', () => {
  beforeEach(() => jest.mocked(fetchBookText).mockReset().mockResolvedValue(synodal));

  it('carries a sign of its colours beside the number, which opens it', () => {
    const onOpen = jest.fn();
    const signs: RibbonSigns = { at: new Map([['1:2', ['#e5484d', '#8b8f98']]]), label: (verse) => `sign ${verse}`, onOpen };
    render(<BookRibbon text={{ id: 'Isaiah', chapters: [['First words.', 'Second words.']] }} lang="en" chapterWord={(c) => `Chapter ${c}`} signs={signs} />);
    expect(screen.queryByTestId('marked-elsewhere-1:1')).toBeNull();
    const sign = screen.getByRole('button', { name: 'sign 2' });
    expect([...sign.querySelectorAll('span span')].map((stripe) => (stripe as HTMLElement).style.backgroundColor)).toEqual(['rgb(229, 72, 77)', 'rgb(139, 143, 152)']);
    fireEvent.click(sign);
    expect(onOpen).toHaveBeenCalledWith(1, 2);
  });

  it('opens whole, in the words of the translation where it was marked, painted as there', async () => {
    const elsewhere = markedElsewhere('kjv', 'Isaiah', [{ bible: 'rst', marks: { '4:1': { m: [[0, 3, 'orange'], [5, 9, 'red']], p: [[5, 6, 'gray']] } } }]);
    const onOpenBible = jest.fn();
    render(
      <MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="ru" entries={versesElsewhere(elsewhere, '4:1')} onClose={jest.fn()} onOpenBible={onOpenBible} />
    );
    const there = screen.getByTestId('marked-in-rst');
    const verse = await within(there).findByText('Уповайте');
    const words = [...verse.closest('p')!.querySelectorAll('[data-word]')];
    expect(words.map((word) => word.textContent).join(' ')).toBe('Уповайте на Господа вовеки, ибо Господь Бог есть твердыня вечная:');
    const painted = (word: string) => words.find((element) => element.textContent === word)!.className;
    expect(painted('Уповайте')).toContain('bg-[#ffdcc2]');
    expect(painted('ибо')).toBe('');
    expect(painted('Господь')).toContain('bg-[#fdd8d8]');
    expect(painted('Господь')).toContain('decoration-[#8b8f98]');
    expect(fetchBookText).toHaveBeenCalledWith('Isaiah', 'rst');
    fireEvent.click(within(there).getByRole('button', { name: 'bible.marks.openThere' }));
    expect(onOpenBible).toHaveBeenCalledWith('rst');
  });

  it('opens nothing where no other Bible marked the verse', () => {
    render(<MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="ru" entries={[]} onClose={jest.fn()} onOpenBible={jest.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
