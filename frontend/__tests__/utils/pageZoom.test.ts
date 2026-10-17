import { act, renderHook } from '@testing-library/react';

import { isPageZoomed, usePageZoomed } from '@/utils/pageZoom';

describe('the page pinched bigger', () => {
  afterEach(() => Reflect.deleteProperty(window, 'visualViewport'));

  it('is the browser\'s own zoom: a scale other than one', () => {
    expect(isPageZoomed()).toBe(false);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), { scale: 1 }) });
    expect(isPageZoomed()).toBe(false);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), { scale: 1.6 }) });
    expect(isPageZoomed()).toBe(true);
  });

  it('follows the pinch', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const { result } = renderHook(() => usePageZoomed());
    expect(result.current).toBe(false);
    act(() => {
      viewport.scale = 2;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);
  });
});
