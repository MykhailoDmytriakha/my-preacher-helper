import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';

import { useModalLayer } from '@/hooks/useModalLayer';
import { canGoBackToPage } from '@/utils/modalHistory.client';

import '@testing-library/jest-dom';

function DirectPage() {
  const [open, setOpen] = useState(false);
  const layer = useModalLayer({ active: open, onClose: () => setOpen(false) });
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    <button onClick={() => { if (!canGoBackToPage()) window.history.pushState(null, '', '/dashboard'); }}>Return to dashboard</button>
    {open && <div {...layer} role="dialog" aria-label="Settings window"><button onClick={() => setOpen(false)}>Close</button></div>}
  </>;
}

it('retains the direct-page fallback after closing, Back to the first page, and opening another window', async () => {
  window.history.replaceState(null, '', '/settings');
  expect(window.history.length).toBe(1);
  const view = render(<DirectPage />);
  fireEvent.click(screen.getByText('Open'));
  fireEvent.click(screen.getByText('Close'));
  expect(canGoBackToPage()).toBe(false);

  await act(async () => {
    window.history.back();
    await new Promise(resolve => setTimeout(resolve, 25));
  });
  expect(window.location.pathname).toBe('/settings');
  expect(canGoBackToPage()).toBe(false);

  fireEvent.click(screen.getByText('Open'));
  fireEvent.click(screen.getByText('Close'));
  expect(canGoBackToPage()).toBe(false);
  fireEvent.click(screen.getByText('Return to dashboard'));
  expect(window.location.pathname).toBe('/dashboard');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(window.location.pathname).toBe('/settings');
  expect(canGoBackToPage()).toBe(false);
  fireEvent.click(screen.getByText('Open'));
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(screen.queryByRole('dialog', { name: 'Settings window' })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/settings');
  view.unmount();
});
