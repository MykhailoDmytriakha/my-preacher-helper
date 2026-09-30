import { act, render } from '@testing-library/react';

import { OfflinePageMemory } from '@/components/OfflinePageMemory';
import { OFFLINE_PAGE_SEEN } from '@/utils/offlineRscNavigation';

describe('OfflinePageMemory', () => {
  const listeners = new Set<() => void>();
  const postMessage = jest.fn();
  const container = {
    controller: null as null | { postMessage: jest.Mock },
    addEventListener: jest.fn((_: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: jest.fn((_: string, listener: () => void) => listeners.delete(listener)),
  };

  beforeAll(() => { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container }); });
  beforeEach(() => { listeners.clear(); postMessage.mockClear(); container.controller = { postMessage }; });

  it('tells the worker the page the person sees, and again after every navigation', () => {
    const view = render(<OfflinePageMemory address="/sermons?" />);
    expect(postMessage).toHaveBeenLastCalledWith({ type: OFFLINE_PAGE_SEEN, url: window.location.href });

    view.rerender(<OfflinePageMemory address="/sermons/abc?" />);

    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('tells again when the network comes back or the app returns to the screen: a warm-up may have failed', () => {
    render(<OfflinePageMemory address="/sermons/abc?" />);
    postMessage.mockClear();

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(postMessage).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('tells a worker that takes control later: the first page loads before any worker does', () => {
    container.controller = null;
    render(<OfflinePageMemory address="/dashboard?" />);
    expect(postMessage).not.toHaveBeenCalled();

    container.controller = { postMessage };
    act(() => { listeners.forEach(listener => listener()); });

    expect(postMessage).toHaveBeenCalledWith({ type: OFFLINE_PAGE_SEEN, url: window.location.href });
  });
});
