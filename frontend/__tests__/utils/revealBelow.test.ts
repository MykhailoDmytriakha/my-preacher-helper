import { renderHook } from '@testing-library/react';

import { useScrollLock } from '@/hooks/useScrollLock';
import { revealBelow } from '@/utils/revealBelow';

it('retains the revealed reading anchor until an iOS modal releases its pinned page', () => {
  const ua = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  const touch = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
  const position = Object.getOwnPropertyDescriptor(window, 'scrollY');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPad)' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
  const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const scrollBy = jest.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  const control = document.createElement('div');
  control.getBoundingClientRect = () => ({ top: 11, bottom: 45 } as DOMRect);
  const locked = renderHook(() => useScrollLock(true));
  try {
    revealBelow(control, 137);
    expect(document.body.style.top).toBe('-114px');
    expect(scrollBy).not.toHaveBeenCalled();
    locked.unmount();
    expect(scrollTo).toHaveBeenCalledWith(0, 114);
  } finally {
    locked.unmount(); scrollTo.mockRestore(); scrollBy.mockRestore();
    if (ua) Object.defineProperty(navigator, 'userAgent', ua);
    if (touch) Object.defineProperty(navigator, 'maxTouchPoints', touch);
    if (position) Object.defineProperty(window, 'scrollY', position);
  }
});
