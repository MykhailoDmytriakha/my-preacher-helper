import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ConfirmModal from '@/components/ui/ConfirmModal';
import '@testing-library/jest-dom';

jest.mock('@headlessui/react', () => {
  const React = require('react');
  const Fragment = React.Fragment;

  const Transition: any = ({ show, children }: any) =>
    show ? React.createElement(Fragment, null, children) : null;
  
  const TransitionChild = ({ children }: any) => React.createElement(Fragment, null, children);
  Transition.Child = TransitionChild;

  const Dialog: any = ({ children, as: As = 'div', ...rest }: any) =>
    React.createElement(As, { role: 'dialog', ...rest }, children);
  
  const DialogPanel = ({ children, ...rest }: any) => React.createElement('div', rest, children);
  Dialog.Panel = DialogPanel;
  
  const DialogTitle = ({ as: As = 'h3', children, ...rest }: any) => React.createElement(As, rest, children);
  Dialog.Title = DialogTitle;
  
  const DialogBackdrop = ({ as: As = 'div', ...rest }: any) => React.createElement(As, rest, null);

  return { 
    Transition, 
    TransitionChild, 
    Dialog, 
    DialogPanel, 
    DialogTitle, 
    DialogBackdrop 
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ConfirmModal', () => {
  it('uses non-destructive confirm button style', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm action"
        isDestructive={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'common.confirm' });
    expect(confirmButton).toHaveClass('bg-emerald-600');
    expect(confirmButton).toHaveClass('hover:bg-emerald-500');
  });

  it('calls handlers for confirm and cancel actions', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();

    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete item"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * WHERE THE QUESTION STANDS WHEN IT IS ASKED FROM INSIDE ANOTHER WINDOW.
 *
 * Built on a third-party dialog, this window kept its own stack: over one of our forms it was
 * drawn underneath, and one Escape closed the question AND the form it came from.
 */
describe('ConfirmModal inside the app\'s window stack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FormDialog = require('@/components/ui/FormDialog').default;

  it('closes alone on Escape, leaving the form it was asked from open', () => {
    const closeForm = jest.fn();
    const closeQuestion = jest.fn();
    render(
      <>
        <FormDialog title="Форма" onClose={closeForm}>
          <p>текст</p>
        </FormDialog>
        <ConfirmModal isOpen onClose={closeQuestion} onConfirm={jest.fn()} title="Удалить?" />
      </>
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(closeQuestion).toHaveBeenCalledTimes(1);
    expect(closeForm).not.toHaveBeenCalled();
  });

  it('is drawn above every form layer', () => {
    render(<ConfirmModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="Удалить?" />);

    const layer = document.querySelector('[data-modal-layer="true"]') as HTMLElement;
    expect(layer.className).toContain('z-[300]');
  });

  it('answers a stray Enter with "no": focus starts on Cancel', () => {
    render(<ConfirmModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="Удалить?" />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.cancel' }));
  });

  it('holds the page still while it is open', () => {
    const { unmount } = render(<ConfirmModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="Удалить?" />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('refuses Escape while the deletion is running', () => {
    const onClose = jest.fn();
    render(<ConfirmModal isOpen isDeleting onClose={onClose} onConfirm={jest.fn()} title="Удалить?" />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
