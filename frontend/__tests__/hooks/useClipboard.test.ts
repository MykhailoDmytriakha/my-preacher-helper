import { act, renderHook } from '@testing-library/react';

import { useClipboard } from '@/hooks/useClipboard';

const writeText = jest.fn();
const execCopy = jest.fn();
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  writeText.mockReset().mockResolvedValue(undefined);
  execCopy.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCopy });
});
afterEach(() => { jest.useRealTimers(); });

it('reports the actual pending/success state and confirms only after the exact text is copied', async () => {
  let finish!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const onSuccess = jest.fn();
  const { result } = renderHook(() => useClipboard({ onSuccess, successDuration: 100 }));
  expect(result.current).toMatchObject({ isCopied: false, isLoading: false, error: null });
  let copied!: Promise<boolean>;
  act(() => { copied = result.current.copyToClipboard(' Exact text\nwith whitespace '); });
  expect(result.current.isLoading).toBe(true);
  expect(onSuccess).not.toHaveBeenCalled();
  await act(async () => { finish(); expect(await copied).toBe(true); });
  expect(writeText).toHaveBeenCalledWith(' Exact text\nwith whitespace ');
  expect(result.current).toMatchObject({ isCopied: true, isLoading: false, error: null });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(100));
  expect(result.current.isCopied).toBe(false);
});

it('measures feedback duration from the latest successful copy', async () => {
  const { result } = renderHook(() => useClipboard({ successDuration: 1500 }));
  await act(async () => { await result.current.copyToClipboard('First'); });
  act(() => jest.advanceTimersByTime(1000));
  await act(async () => { await result.current.copyToClipboard('Second'); });
  act(() => jest.advanceTimersByTime(500));
  expect(result.current.isCopied).toBe(true);
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current.isCopied).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['empty', 'denied'] as const)('does not present a previous success after a subsequent %s attempt', async kind => {
  const onError = jest.fn();
  const { result } = renderHook(() => useClipboard({ onError }));
  await act(async () => { await result.current.copyToClipboard('First'); });
  if (kind === 'denied') writeText.mockRejectedValueOnce(new Error('Permission denied'));
  await act(async () => { expect(await result.current.copyToClipboard(kind === 'empty' ? '' : 'Second')).toBe(false); });
  expect(result.current).toMatchObject({ isCopied: false, isLoading: false, error: kind === 'empty' ? 'No text provided' : 'Permission denied' });
  expect(onError).toHaveBeenCalledTimes(kind === 'empty' ? 0 : 1);
  expect(execCopy).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['reset', 'unmount'] as const)('clears feedback timers on %s', async action => {
  const { result, unmount } = renderHook(() => useClipboard());
  await act(async () => { await result.current.copyToClipboard('Text'); });
  act(() => { if (action === 'reset') result.current.reset(); else unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  if (action === 'reset') expect(result.current).toMatchObject({ isCopied: false, error: null });
});

it.each(['reset', 'unmount'] as const)('ignores pending feedback after %s without cancelling the underlying clipboard operation', async action => {
  let finish!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const onSuccess = jest.fn();
  const { result, unmount } = renderHook(() => useClipboard({ onSuccess }));
  let copied!: Promise<boolean>;
  act(() => { copied = result.current.copyToClipboard('Text'); });
  act(() => { if (action === 'reset') result.current.reset(); else unmount(); });
  await act(async () => { finish(); expect(await copied).toBe(true); });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  if (action === 'reset') expect(result.current).toMatchObject({ isCopied: false, isLoading: false, error: null });
});

it('keeps the latest attempt status when an earlier promise settles later', async () => {
  let finishFirst!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finishFirst = resolve; })).mockRejectedValueOnce(new Error('Latest attempt failed'));
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const { result } = renderHook(() => useClipboard({ onSuccess, onError }));
  let first!: Promise<boolean>;
  act(() => { first = result.current.copyToClipboard('First'); });
  await act(async () => { expect(await result.current.copyToClipboard('Second')).toBe(false); });
  await act(async () => { finishFirst(); expect(await first).toBe(true); });
  expect(result.current).toMatchObject({ isCopied: false, isLoading: false, error: 'Latest attempt failed' });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
});

it('removes the temporary fallback textarea even when the browser copy command throws', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  execCopy.mockImplementationOnce(() => { throw new Error('Unsupported'); });
  const { result } = renderHook(() => useClipboard());
  await act(async () => { expect(await result.current.copyToClipboard('Temporary content')).toBe(false); });
  expect(document.querySelector('textarea')).toBeNull();
  expect(result.current.error).toBe('Fallback copy failed');
});


it('normalizes a non-Error browser rejection for the existing error callback', async () => {
  writeText.mockRejectedValueOnce('Denied');
  const onError = jest.fn();
  const { result } = renderHook(() => useClipboard({ onError }));
  await act(async () => { expect(await result.current.copyToClipboard('Text')).toBe(false); });
  expect(result.current.error).toBe('Copy failed');
  expect(onError).toHaveBeenCalledWith(new Error('Copy failed'));
});
