import { fireEvent, render, screen } from '@testing-library/react';

import { SyncNotice, SyncNoticeDock } from '@/components/common/SyncNoticeDock';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const label = 'dataSync.readerNotices';

it('opens both recovery sources from one control, and Escape returns focus to it', () => {
  render(<SyncNoticeDock>
    <SyncNotice><button type="button">Copy retained text</button></SyncNotice>
    <SyncNotice><button type="button">Use stored version</button></SyncNotice>
  </SyncNoticeDock>);
  const trigger = screen.getByRole('button', { name: label });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Copy retained text' })).toBeNull();

  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('region', { name: label })).toBeVisible();
  const action = screen.getByRole('button', { name: 'Use stored version' });
  expect(action).toBeVisible();
  action.focus();
  fireEvent.keyDown(action, { key: 'Escape' });

  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: label })).toBeNull();
});

it('is absent with no saved-work notice and closes between separate arrivals', () => {
  const view = (pending: boolean) => <SyncNoticeDock>
    {pending && <SyncNotice><p>One change is waiting</p></SyncNotice>}
  </SyncNoticeDock>;
  const { rerender } = render(view(false));
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  rerender(view(true));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByText('One change is waiting')).toBeVisible();
  rerender(view(false));
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  rerender(view(true));
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('One change is waiting')).not.toBeVisible();
});

it('sizes the open panel from its actual top edge and follows a viewport resize', () => {
  render(<SyncNoticeDock><SyncNotice>Pending change</SyncNotice></SyncNoticeDock>);
  const trigger = screen.getByRole('button', { name: label });
  const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  const originalHeight = window.innerHeight;
  let top = 112;
  const box = jest.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect);
  try {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 });
    fireEvent.click(trigger);
    expect(panel.style.getPropertyValue('--sync-notice-room')).toBe('208px');

    top = 136;
    fireEvent(window, new Event('resize'));
    expect(panel.style.getPropertyValue('--sync-notice-room')).toBe('184px');
  } finally {
    box.mockRestore();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  }
});


it('offers a workspace status only when there is a save problem to show', () => {
  const view = (error: string | null) => <SyncNoticeDock>
    <DataSyncStatus workspaceNotice subject="settings" status={null} error={error} />
  </SyncNoticeDock>;
  const { rerender } = render(view(null));
  expect(screen.queryByRole('button', { name: label })).toBeNull();

  rerender(view('Could not save the reading settings'));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save the reading settings');

  rerender(view(null));
  expect(screen.queryByRole('button', { name: label })).toBeNull();
});
