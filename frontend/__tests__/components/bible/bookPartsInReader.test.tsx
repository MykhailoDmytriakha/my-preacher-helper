import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';

import { BookNavigator } from '@/components/bible/BiblePicker';
import { BOOK_PART_TONES } from '@/utils/themeColors';

/*
 * The reader's window of books shows the parts of a group as the Bible page does: Philemon among the letters from
 * prison, each part in its colour, the open book lit in its part's colour (owner, 2026-11-21, canvas «Библия — группы книг»).
 */
beforeEach(() => {
  global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
});

it('shows a split group part after part in its colours, the open book lit in its part\'s colour', () => {
  const anchorRef = createRef<HTMLButtonElement>();
  render(
    <>
      <button ref={anchorRef} type="button">anchor</button>
      <BookNavigator start="books" bookId="Colossians" bible="rst" currentChapter={1} currentVerse={1} text={null} locale="en" wide anchorRef={anchorRef} onClose={jest.fn()} onOpen={jest.fn()} label="window" />
    </>,
  );
  const window_ = screen.getByRole('dialog', { name: 'window' });
  const paul = within(window_).getByRole('heading', { name: 'bible.groups.paulineEpistles' }).parentElement as HTMLElement;
  const books = within(paul).getAllByRole('button').map((button) => button.textContent);
  expect(books.indexOf('Philemon')).toBe(books.indexOf('Colossians') + 1);
  expect(within(paul).getByRole('list', { name: 'bible.bookParts.prisonEpistles.name' })).toBeInTheDocument();
  expect(within(paul).getByRole('button', { name: 'Philemon' })).toHaveClass(...BOOK_PART_TONES[1].chip.split(' '));
  expect(within(paul).getByRole('button', { name: 'Hebrews' })).toHaveClass(...BOOK_PART_TONES[4].chip.split(' '));
  const open = within(paul).getByRole('button', { name: 'Colossians' });
  expect(open).toHaveAttribute('aria-current', 'true');
  // Lit in its own part's colour, not the app's indigo (owner, 2026-11-21: «подсветка должна быть того же самого цвета»).
  expect(open).toHaveClass(...BOOK_PART_TONES[1].selected.split(' '));
  expect(open).not.toHaveClass('bg-indigo-600');
  // A book of a group that is not split keeps the indigo.
  expect(screen.getByRole('button', { name: 'Genesis' })).not.toHaveClass('bg-blue-100');
});
