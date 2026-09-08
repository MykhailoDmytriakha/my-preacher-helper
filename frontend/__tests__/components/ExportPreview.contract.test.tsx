import { act, fireEvent, render, screen } from '@testing-library/react';

import { ExportPdfModal } from '@/components/export-buttons/ExportPdfModal';
import { ExportTxtModal } from '@/components/export-buttons/ExportTxtModal';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }) }));
jest.mock('html2canvas', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const view = (kind: 'text' | 'pdf', isOpen: boolean, getContent: () => Promise<string>) => kind === 'text'
  ? <ExportTxtModal isOpen={isOpen} onClose={jest.fn()} getContent={getContent} />
  : <ExportPdfModal isOpen={isOpen} onClose={jest.fn()} getContent={getContent} title="Sermon" />;

it.each(['text', 'pdf'] as const)('keeps the newest %s preview when an older preparation finishes later', async kind => {
  const old = deferred();
  const current = deferred();
  const { rerender } = render(view(kind, true, () => old.promise));
  rerender(view(kind, true, () => current.promise));
  await act(async () => { current.resolve('Current preview'); });
  expect(screen.getByText('Current preview')).toBeInTheDocument();
  await act(async () => { old.resolve('Obsolete preview'); });
  expect(screen.getByText('Current preview')).toBeInTheDocument();
  expect(screen.queryByText('Obsolete preview')).toBeNull();
});

it.each(['text', 'pdf'] as const)('ignores a previous %s preview failure after the current preview succeeds', async kind => {
  const old = deferred();
  const { rerender } = render(view(kind, true, () => old.promise));
  rerender(view(kind, true, async () => 'Current preview'));
  await screen.findByText('Current preview');
  await act(async () => { old.reject(new Error('Obsolete failure')); });
  expect(screen.getByText('Current preview')).toBeInTheDocument();
});

it.each(['text', 'pdf'] as const)('keeps a reopened %s export independent of a closed preparation', async kind => {
  const old = deferred();
  const current = deferred();
  const getContent = jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { rerender } = render(view(kind, true, getContent));
  rerender(view(kind, false, getContent));
  rerender(view(kind, true, getContent));
  await act(async () => { current.resolve('Reopened preview'); });
  await act(async () => { old.resolve('Closed preview'); });
  expect(screen.getByText('Reopened preview')).toBeInTheDocument();
  expect(screen.queryByText('Closed preview')).toBeNull();
  expect(getContent).toHaveBeenCalledTimes(2);
});

it('keeps supplied text when an earlier asynchronous builder finishes', async () => {
  const old = deferred();
  const getContent = () => old.promise;
  const { rerender } = render(<ExportTxtModal isOpen onClose={jest.fn()} getContent={getContent} />);
  rerender(<ExportTxtModal isOpen onClose={jest.fn()} getContent={getContent} content="Supplied preview" />);
  await act(async () => { old.resolve('Obsolete preview'); });
  expect(screen.getByText('Supplied preview')).toBeInTheDocument();
});

it.each([['plain', 'export.txt'], ['markdown', 'export.md']] as const)('downloads %s with the advertised extension and releases the temporary file URL', async (format, filename) => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const createURL = jest.fn(() => 'blob:export-proof');
  const revokeURL = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
    expect(this.download).toBe(filename);
    expect(this.href).toBe('blob:export-proof');
  });
  try {
    render(<ExportTxtModal isOpen onClose={jest.fn()} getContent={jest.fn()} content="Exact file content" format={format} />);
    await screen.findByText('Exact file content');
    fireEvent.click(screen.getByRole('button', { name: format === 'plain' ? 'export.downloadTxt' : 'Download MD' }));
    expect(createURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(revokeURL).toHaveBeenCalledWith('blob:export-proof');
    expect(document.querySelector('a[download]')).toBeNull();
  } finally { click.mockRestore(); jest.useRealTimers(); }
});
