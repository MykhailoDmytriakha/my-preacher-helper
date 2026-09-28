import { act, render, screen } from '@testing-library/react';

import { DeviceStorageNotice } from '@/components/DeviceStorageNotice';
import { STORAGE_ANSWER_SETTLE_MS, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS, resetDeviceStorageForTests, trackStorage } from '@/utils/deviceStorage';

const SILENT = STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS;

import '@testing-library/jest-dom';

/** The one notice that says why records are read-only (BUG-20260927-engine-open-hangs-on-silent-device-storage). */
describe('DeviceStorageNotice', () => {
  beforeEach(() => { jest.useFakeTimers(); resetDeviceStorageForTests(); });
  afterEach(() => { jest.useRealTimers(); });

  it('stays out of the way while storage answers', () => {
    render(<DeviceStorageNotice />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears once engine storage is silent, and leaves when it answers again', async () => {
    let answer!: () => void;
    void trackStorage('engine-state', new Promise<void>(resolve => { answer = resolve; }));
    render(<DeviceStorageNotice />);

    act(() => { jest.advanceTimersByTime(SILENT); });
    expect(screen.getByRole('status')).toHaveTextContent('deviceStorage.title');
    expect(screen.getByRole('status')).toHaveTextContent('deviceStorage.body');

    await act(async () => { answer(); await Promise.resolve(); });
    // It leaves once storage has stayed answering for a moment, so it does not blink.
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing about a silent query cache, which leaves every record editable', () => {
    void trackStorage('query-cache', new Promise(() => undefined));
    render(<DeviceStorageNotice />);
    act(() => { jest.advanceTimersByTime(SILENT); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
