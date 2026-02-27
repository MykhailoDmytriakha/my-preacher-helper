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
