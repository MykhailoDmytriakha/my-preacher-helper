import { copyFormattedFromElement } from '@/(pages)/(private)/sermons/[id]/plan/copyFormattedFromElement';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: jest.fn().mockReturnValue(true) });
});

it('returns success after rich fallback and removes its temporary element exactly once', async () => {
  const source = document.createElement('div');
  source.innerHTML = '<h2>Plan heading</h2><p><strong>Bold reminder</strong></p>';
  document.body.appendChild(source);
  const before = document.body.innerHTML;
  await expect(copyFormattedFromElement(source)).resolves.toBe(true);
  expect(document.body.innerHTML).toBe(before);
  expect(document.execCommand).toHaveBeenCalledTimes(1);
});

it('leaves no temporary plain textarea when both fallback attempts throw', async () => {
  const source = document.createElement('div');
  source.textContent = 'Exact note';
  document.body.appendChild(source);
  (document.execCommand as jest.Mock).mockImplementation(() => { throw new Error('Command failed'); });
  await expect(copyFormattedFromElement(source)).resolves.toBe(false);
  expect(document.body.querySelector('textarea')).toBeNull();
  expect(document.body.children).toHaveLength(1);
});

it('returns false for an absent rendered plan', async () => {
  await expect(copyFormattedFromElement(null)).resolves.toBe(false);
  expect(document.execCommand).not.toHaveBeenCalled();
});

it('writes HTML and exact plain text together when rich clipboard is available', async () => {
  const write = jest.fn().mockResolvedValue(undefined);
  const item = jest.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: item });
  const source = document.createElement('div');
  source.innerHTML = '<strong>Plan</strong>';
  Object.defineProperty(source, 'innerText', { value: 'Plan' });
  try {
    await expect(copyFormattedFromElement(source)).resolves.toBe(true);
    const blobs = item.mock.calls[0][0];
    expect(blobs['text/html']).toBeInstanceOf(Blob);
    expect(blobs['text/html'].type).toBe('text/html');
    expect(blobs['text/html'].size).toBe('<strong>Plan</strong>'.length);
    expect(blobs['text/plain'].size).toBe(4);
    expect(write).toHaveBeenCalledWith([item.mock.instances[0]]);
    expect(document.execCommand).not.toHaveBeenCalled();
  } finally { Reflect.deleteProperty(window, 'ClipboardItem'); }
});

it('uses plain text selection if formatted selection is refused', async () => {
  const source = document.createElement('div');
  Object.defineProperty(source, 'innerText', { value: 'Exact rendered text' });
  (document.execCommand as jest.Mock).mockReturnValueOnce(false).mockImplementationOnce(() => {
    expect((document.activeElement as HTMLTextAreaElement).value).toBe('Exact rendered text');
    return true;
  });
  await expect(copyFormattedFromElement(source)).resolves.toBe(true);
  expect(document.body.children).toHaveLength(0);
  expect(window.getSelection()?.rangeCount).toBe(0);
});
