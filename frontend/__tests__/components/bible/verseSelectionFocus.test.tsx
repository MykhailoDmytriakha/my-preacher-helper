import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';

import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';

const origin = { chapter: 1, verse: 1 };
const text = { id: 'Ruth', chapters: [['Verse']] };

function Reader({ rowVersion, bookId = 'Ruth' }: { rowVersion?: number; bookId?: string }) {
  const textRef = useRef<HTMLElement>(null);
  const copy = useVerseCopy({ textRef, text, bible: 'kjv', bookId, enabled: true });
  return (
    <>
      <button type="button">Choose a book</button>
      <article ref={textRef}>
        {rowVersion !== undefined && (
          <div key={rowVersion} data-verse="1:1">
            <button type="button" data-verse-menu onClick={() => copy.startPicking(origin, false, true)}>
              Verse menu
            </button>
          </div>
        )}
      </article>
      <button type="button" onClick={() => copy.startPicking(origin, true)}>Start a touch choice</button>
      {copy.picking && (
        <div data-verse-bar>
          <button type="button" onClick={copy.cancelSelection}>Cancel choosing verses</button>
        </div>
      )}
    </>
  );
}

async function startWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  const menu = screen.getByRole('button', { name: 'Verse menu' });
  act(() => menu.focus());
  await user.keyboard('{Enter}');
  return menu;
}

it('returns to the replacement button when the same verse is drawn again', async () => {
  const user = userEvent.setup();
  const reader = render(<Reader rowVersion={1} />);
  const original = await startWithKeyboard(user);
  reader.rerender(<Reader />);
  reader.rerender(<Reader rowVersion={2} />);
  const replacement = screen.getByRole('button', { name: 'Verse menu' });
  expect(original).not.toBeInTheDocument();
  const cancel = screen.getByRole('button', { name: 'Cancel choosing verses' });
  act(() => cancel.focus());
  await user.keyboard('{Escape}');
  expect(cancel).not.toBeInTheDocument();
  expect(replacement).toHaveFocus();
});

it('Escape clears the choice and leaves focus on a separate screen control', async () => {
  const user = userEvent.setup();
  render(<Reader rowVersion={1} />);
  await startWithKeyboard(user);
  const header = screen.getByRole('button', { name: 'Choose a book' });
  act(() => header.focus());
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'Cancel choosing verses' })).toBeNull();
  expect(header).toHaveFocus();
});

it('a new book clears the old choice even when the same verse number is shown', async () => {
  const user = userEvent.setup();
  const reader = render(<Reader rowVersion={1} />);
  await startWithKeyboard(user);
  const header = screen.getByRole('button', { name: 'Choose a book' });
  act(() => header.focus());
  reader.rerender(<Reader bookId="Romans" rowVersion={2} />);
  expect(screen.queryByRole('button', { name: 'Cancel choosing verses' })).toBeNull();
  expect(header).toHaveFocus();
});

it('a touch choice does not inherit a previous keyboard choice’s return target', async () => {
  const user = userEvent.setup();
  render(<Reader rowVersion={1} />);
  const menu = await startWithKeyboard(user);
  await user.click(screen.getByRole('button', { name: 'Start a touch choice' }));
  const cancel = screen.getByRole('button', { name: 'Cancel choosing verses' });
  await user.click(cancel);
  expect(cancel).not.toBeInTheDocument();
  expect(menu).not.toHaveFocus();
});
