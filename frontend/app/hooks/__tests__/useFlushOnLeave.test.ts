import { act, renderHook } from '@testing-library/react';

import { useFlushOnLeave } from '../useFlushOnLeave';

function getBeforeUnloadHandler(
  spy: jest.SpyInstance,
): (event: BeforeUnloadEvent) => void {
  const call = spy.mock.calls.find(([eventName]) => eventName === 'beforeunload');
  expect(call).toBeDefined();
  return call?.[1] as (event: BeforeUnloadEvent) => void;
}

function makeBeforeUnloadEvent(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;

  Object.defineProperty(event, 'returnValue', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  event.preventDefault = jest.fn();

  return event;
}

describe('useFlushOnLeave', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers and unregisters the beforeunload listener on mount and unmount', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const flushSave = jest.fn().mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useFlushOnLeave(flushSave, false));

    const beforeUnloadHandler = getBeforeUnloadHandler(addEventListenerSpy);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', beforeUnloadHandler);
  });

  it('prevents beforeunload when dirty', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const flushSave = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useFlushOnLeave(flushSave, true));
    const beforeUnloadHandler = getBeforeUnloadHandler(addEventListenerSpy);
    const event = makeBeforeUnloadEvent();

    act(() => {
      beforeUnloadHandler(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe('');
  });

  it('does not prevent beforeunload when clean', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const flushSave = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useFlushOnLeave(flushSave, false));
    const beforeUnloadHandler = getBeforeUnloadHandler(addEventListenerSpy);
    const event = makeBeforeUnloadEvent();

    act(() => {
      beforeUnloadHandler(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBeUndefined();
  });

  it('triggers flushSave when the document becomes hidden and dirty', () => {
    const flushSave = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useFlushOnLeave(flushSave, true));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(flushSave).toHaveBeenCalledTimes(1);
  });

  it('triggers flushSave on unmount when dirty', () => {
    const flushSave = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useFlushOnLeave(flushSave, true));

    unmount();

    expect(flushSave).toHaveBeenCalledTimes(1);
  });
});
