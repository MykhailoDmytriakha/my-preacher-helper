import { act, renderHook } from '@testing-library/react';

import { useExportPreview } from '@/components/export-buttons/useExportPreview';

it('does not prepare a closed preview and prepares once when opened', async () => {
  const load = jest.fn().mockResolvedValue('Prepared');
  const { result, rerender } = renderHook(({ open }) => useExportPreview(open, load), { initialProps: { open: false } });
  expect(load).not.toHaveBeenCalled();
  await act(async () => { rerender({ open: true }); });
  expect(result.current).toEqual({ content: 'Prepared', isLoading: false, error: false });
  expect(load).toHaveBeenCalledTimes(1);
});

it('exposes the current failure and recovers when a new builder succeeds', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const load = () => { throw new Error('Preparation failed'); };
  const { result, rerender } = renderHook(({ builder }) => useExportPreview(true, builder), { initialProps: { builder: load as () => Promise<string> } });
  await act(async () => {});
  expect(result.current).toEqual({ content: null, isLoading: false, error: true });
  expect(error).toHaveBeenCalledWith('Error preparing export content:', expect.any(Error));
  await act(async () => { rerender({ builder: async () => 'Recovered' }); });
  expect(result.current).toEqual({ content: 'Recovered', isLoading: false, error: false });
  error.mockRestore();
});

it.each(['success', 'failure'] as const)('ignores a pending %s after unmount', async outcome => {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const load = () => new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const { unmount } = renderHook(() => useExportPreview(true, load));
  await act(async () => {});
  unmount();
  await act(async () => { if (outcome === 'success') resolve('Obsolete'); else reject(new Error('Obsolete')); });
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
