import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { useModalLayer } from '@/hooks/useModalLayer';

import '@testing-library/jest-dom';

function ReadingWindow({ onClose }: { onClose: () => void }) {
  const layer = useModalLayer({ onClose });
  return <div {...layer} role="dialog" aria-label="Reading window">
    <textarea aria-label="Draft words" defaultValue="Keep the words at the heading" />
    <button onClick={() => { window.location.hash = 'reading'; }}>Reveal heading</button>
  </div>;
}

it('treats a newly revealed fragment as reading, then Back reaches the close policy at that fragment without reload', async () => {
  window.history.replaceState({ __NA: true, routeTree: 'opaque-current-page' }, '', '/dashboard');
  window.history.pushState({ __NA: true, routeTree: 'opaque-current-page' }, '', '/bible');
  const close = jest.fn();
  const go = jest.spyOn(window.history, 'go');
  const view = render(<ReadingWindow onClose={close} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reveal heading' }));
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  expect(window.location.hash).toBe('#reading');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Draft words' })).toHaveValue('Keep the words at the heading');
  const headingAddress = window.location.href;

  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 80)); });
  expect(close).toHaveBeenCalledTimes(1);
  expect(window.location.href).toBe(headingAddress);
  expect(screen.getByRole('textbox', { name: 'Draft words' })).toHaveValue('Keep the words at the heading');
  expect(go).not.toHaveBeenCalledWith(0);
  expect(window.history.state).toMatchObject({ __NA: true, routeTree: 'opaque-current-page' });
  view.unmount();
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(window.location.href).toBe('http://localhost/bible');
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(window.location.href).toBe(headingAddress);
  expect(close).toHaveBeenCalledTimes(1);
  go.mockRestore();
});
