import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';

import { VerseHoldSurface } from '@/components/bible/verseCopy/VerseHoldSurface';
import { VerseMenu } from '@/components/bible/verseCopy/VerseMenu';
import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { isAvailableFocusTarget } from '@/utils/focusableElements';

jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

function Reader() {
  const articleRef = useRef<HTMLElement | null>(null);
  const copy = useVerseCopy({ textRef: articleRef, text: { id: 'hebrews', chapters: [['First verse.']] }, bible: 'kjv', bookId: 'Hebrews', enabled: true });
  return <><button type="button">Reader control</button><VerseHoldSurface copy={copy} articleRef={articleRef} className=""><p data-verse="1:1"><span data-verse-text="">First verse.</span></p></VerseHoldSurface><VerseMenu copy={copy} /></>;
}

it('focuses the first item after the positioned menu becomes visible and restores its opener', async () => {
  // jsdom accepts focus on hidden controls; native browsers refuse it, including hidden ancestors.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')!;
  const nativeFocus = HTMLElement.prototype.focus;
  Object.defineProperty(HTMLElement.prototype, 'focus', { configurable: true, writable: true, value: function (this: HTMLElement, options?: FocusOptions) {
    if (isAvailableFocusTarget(this)) nativeFocus.call(this, options);
  } });
  try {
    render(<Reader />);
    const opener = screen.getByRole('button', { name: 'Reader control' });
    opener.focus();
    fireEvent.contextMenu(screen.getByText('First verse.'), { clientX: 40, clientY: 40 });
    const menu = await screen.findByRole('menu', { name: 'bible.copy.menu' });
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'bible.copy.copy' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(opener).toHaveFocus();
  } finally { Object.defineProperty(HTMLElement.prototype, 'focus', descriptor); }
});
