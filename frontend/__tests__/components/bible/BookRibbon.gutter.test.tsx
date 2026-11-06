import { fireEvent, render, screen } from '@testing-library/react';

import { BookRibbon, ChapterVerses } from '@/components/bible/BookRibbon';

const text = { id: 'ruth', chapters: [['First verse.', 'Second verse.']] };
const chapterWord = (chapter: number) => `Chapter ${chapter}`;

describe('BookRibbon menu space', () => {
  it.each([true, false])('does not attach an unconditional gutter to menu-capable rows (enabled=%s)', (enabled) => {
    const { container } = render(<BookRibbon text={text} lang="en" chapterWord={chapterWord}
      verseMenu={{ enabled, label: (chapter, verse) => `Menu ${chapter}:${verse}`, open: jest.fn() }} />);
    const rows = container.querySelectorAll('[data-verse]');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toHaveClass('pr-9');
    expect(container.querySelectorAll('[data-verse-menu]')).toHaveLength(enabled ? 2 : 0);
  });

  it('retains the exact verse and row when the menu button is pressed', () => {
    const open = jest.fn();
    const { container } = render(<BookRibbon text={text} lang="en" chapterWord={chapterWord}
      verseMenu={{ enabled: true, label: (chapter, verse) => `Menu ${chapter}:${verse}`, open }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu 1:2' }));
    expect(open).toHaveBeenCalledWith(1, 2, container.querySelector('[data-verse="1:2"]'));
  });

  it('leaves a ribbon without the capability free of a menu and gutter', () => {
    const { container } = render(<BookRibbon text={text} lang="en" chapterWord={chapterWord} />);
    expect(container.querySelectorAll('[data-verse-menu]')).toHaveLength(0);
    for (const row of container.querySelectorAll('[data-verse]')) expect(row).not.toHaveClass('pr-9');
  });

  it('keeps a detached chapter outside the reader menu and verse index', () => {
    const { container } = render(<ChapterVerses chapter={1} verses={text.chapters[0]} lang="en" lit={() => false} />);
    expect(screen.getByText('First verse.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-verse], [data-verse-menu]')).toHaveLength(0);
    expect(container.querySelector('.pr-9')).toBeNull();
  });
});
