import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import FormDialog from '@/components/ui/FormDialog';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));

/**
 * WHAT EVERY DIALOG IN THIS APP OWES THE PERSON IN FRONT OF IT.
 *
 * These are not decoration. The page scrolling away behind an open form is what the owner
 * reported from his iPad; Escape is the way out every other application has taught him.
 */
const renderDialog = (props: Partial<React.ComponentProps<typeof FormDialog>> = {}) =>
  render(
    <FormDialog title="Новая проповедь" onClose={jest.fn()} {...props}>
      <p>тело</p>
    </FormDialog>
  );

describe('an open dialog holds the page still', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('locks the page while it is open', () => {
    renderDialog();

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('gives the page back when it closes', () => {
    const { unmount } = renderDialog();

    unmount();

    expect(document.body.style.overflow).toBe('');
  });

  it('locks the page in its banded form too', () => {
    renderDialog({ footer: <button type="button">Сохранить</button> });

    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('an open dialog can be left', () => {
  it('closes on Escape', () => {
    const onClose = jest.fn();
    renderDialog({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses Escape while a save is in flight, like every other way out', () => {
    const onClose = jest.fn();
    renderDialog({ onClose, closeDisabled: true });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('only the topmost dialog answers Escape', () => {
    const outer = jest.fn();
    const inner = jest.fn();
    render(
      <>
        <FormDialog title="Внешнее" onClose={outer}>
          <p>a</p>
        </FormDialog>
        <FormDialog title="Внутреннее" onClose={inner}>
          <p>b</p>
        </FormDialog>
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('a dialog says what it is', () => {
  it('names itself a dialog, in both forms', () => {
    const { unmount } = renderDialog();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    unmount();

    renderDialog({ footer: <button type="button">Сохранить</button> });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
