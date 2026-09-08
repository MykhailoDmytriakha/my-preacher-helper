import { copyPlainText, copyTextWithSelection } from '@/utils/clipboard';

const writeText = jest.fn();
const execCopy = jest.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  execCopy.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCopy });
});

it('writes exact plain text through the secure clipboard without creating selection elements', async () => {
  await expect(copyPlainText(' Text\nwith whitespace ')).resolves.toBeUndefined();
  expect(writeText).toHaveBeenCalledWith(' Text\nwith whitespace ');
  expect(execCopy).not.toHaveBeenCalled();
  expect(document.querySelector('textarea')).toBeNull();
});

it('preserves a modern permission rejection instead of reporting a successful fallback', async () => {
  const failure = new Error('Permission denied');
  writeText.mockRejectedValueOnce(failure);
  await expect(copyPlainText('Text')).rejects.toBe(failure);
  expect(execCopy).not.toHaveBeenCalled();
});

it.each(['missing', 'insecure'] as const)('uses selection when the clipboard is %s and restores focus without scrolling', async reason => {
  if (reason === 'missing') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  else Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  execCopy.mockImplementationOnce(() => {
    const temporary = document.activeElement as HTMLTextAreaElement;
    expect(temporary.tagName).toBe('TEXTAREA');
    expect(temporary.value).toBe(' Exact\nselection ');
    expect(temporary.selectionStart).toBe(0);
    expect(temporary.selectionEnd).toBe(temporary.value.length);
    return true;
  });
  await expect(copyPlainText(' Exact\nselection ')).resolves.toBeUndefined();
  expect(document.activeElement).toBe(input);
  expect(document.querySelector('textarea')).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
});

it.each(['false', 'exception'] as const)('reports a failed legacy copy and cleans its element on %s', async reason => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  execCopy.mockImplementation(() => { if (reason === 'exception') throw new Error('Unavailable'); return false; });
  await expect(copyPlainText('Text')).rejects.toThrow('Fallback copy failed');
  expect(document.querySelector('textarea')).toBeNull();
});

it('exposes the same selection transport to rich text as a boolean result', () => {
  expect(copyTextWithSelection('Rich fallback')).toBe(true);
  expect(execCopy).toHaveBeenCalledTimes(1);
  expect(document.querySelector('textarea')).toBeNull();
});
