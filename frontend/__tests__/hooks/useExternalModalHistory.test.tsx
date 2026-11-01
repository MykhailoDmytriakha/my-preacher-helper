import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';

import { useExternalModalHistory } from '@/hooks/useExternalModalHistory';
import { useModalLayer } from '@/hooks/useModalLayer';

import '@testing-library/jest-dom';

async function back() {
  await act(async () => {
    window.history.back();
    await new Promise(resolve => setTimeout(resolve, 30));
  });
}

function External({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => { onClose(); setOpen(false); };
  const ref = useExternalModalHistory({ active: open, onClose: close });
  return <Dialog ref={ref} open={open} onClose={close} style={{ zIndex: 200 }}>
    <DialogPanel><DialogTitle>Library window</DialogTitle><button onClick={close}>Library close</button></DialogPanel>
  </Dialog>;
}

function Parent({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const layer = useModalLayer({ active: open, onClose: () => { onClose(); setOpen(false); } });
  return open ? <div {...layer} role="dialog" aria-label="Parent window" style={{ zIndex: 100 }}><textarea aria-label="Parent draft" defaultValue="Keep parent words" /></div> : null;
}

beforeEach(() => {
  window.history.replaceState({ __NA: true }, '', '/dashboard');
  window.history.pushState({ __NA: true }, '', '/bible');
});

it('closes a library dialog on Back while its own focus trap remains active', async () => {
  const close = jest.fn();
  const view = render(<External onClose={close} />);
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Library window' })).toContainElement(document.activeElement as HTMLElement));
  await back();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe('/bible');
  await back();
  await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  view.unmount();
});

it('closes the higher library dialog before the retained parent and keeps parent words', async () => {
  const parentClose = jest.fn();
  const externalClose = jest.fn();
  const view = render(<><Parent onClose={parentClose} /><External onClose={externalClose} /></>);
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Library window' })).toContainElement(document.activeElement as HTMLElement));
  await back();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Library close' })).not.toBeInTheDocument());
  expect(externalClose).toHaveBeenCalledTimes(1);
  expect(parentClose).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Keep parent words');
  expect(window.location.pathname).toBe('/bible');
  await back();
  await waitFor(() => expect(parentClose).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog', { name: 'Parent window' })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/bible');
  view.unmount();
});

it('unregisters a library dialog on its ordinary close button', async () => {
  const close = jest.fn();
  const view = render(<External onClose={close} />);
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Library window' })).toContainElement(document.activeElement as HTMLElement));
  fireEvent.click(screen.getByRole('button', { name: 'Library close' }));
  await back();
  await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
});
