import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';

import FormDialog from '@/components/ui/FormDialog';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));

/*
 * BUG-20261104-modal-focus-not-moved: a window opened from the keyboard left the focus on the button under it, and closing
 * it left the focus nowhere. The keyboard and a screen reader arrive with the eye: the window takes the focus when it comes
 * (the window itself — a field taking it would raise a phone's keyboard), and gives it back to what opened it when it goes.
 */
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Открыть</button>
      {open ? <FormDialog title="Окно" onClose={() => setOpen(false)}><input aria-label="поле" /></FormDialog> : null}
    </>
  );
}

describe('a window and the keyboard', () => {
  it('takes the focus when it opens — itself, not a field — and gives it back to what opened it when it closes', () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByLabelText('поле'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves the focus where the window put it itself', () => {
    function Typed() {
      return <FormDialog title="Окно" onClose={jest.fn()}><input aria-label="поле" autoFocus /></FormDialog>;
    }
    render(<Typed />);
    expect(document.activeElement).toBe(screen.getByLabelText('поле'));
  });

  // Codex, 05.11: a field taking the focus itself was taken for what opened the window, and closing left the focus nowhere.
  it('gives the focus back to what opened it when a field in it took the focus itself', () => {
    function Typed() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Открыть</button>
          {open ? <FormDialog title="Окно" onClose={() => setOpen(false)}><input aria-label="поле" autoFocus /></FormDialog> : null}
        </>
      );
    }
    render(<Typed />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('поле'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  // Codex, 05.11: from the window itself, focused as it came, Shift+Tab reached the page behind it.
  it('turns Shift+Tab round inside from the window itself', async () => {
    render(<><button type="button">Под окном</button><FormDialog title="Окно" onClose={jest.fn()}><input aria-label="поле" /></FormDialog></>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    await userEvent.setup().tab({ shift: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});
