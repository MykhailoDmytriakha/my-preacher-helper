import { clipboardHasText, extractClipboardImageFiles } from '@/utils/clipboardImages';

function imageFile(name = 'screenshot.png', type = 'image/png'): File {
  return new File(['x'], name, { type });
}

function fileItem(file: File | null, kind = 'file'): DataTransferItem {
  return {
    kind,
    type: file?.type ?? 'text/plain',
    getAsFile: () => file,
    getAsString: () => undefined,
    webkitGetAsEntry: () => null,
  } as unknown as DataTransferItem;
}

describe('extractClipboardImageFiles', () => {
  test('returns nothing when there is no clipboard', () => {
    expect(extractClipboardImageFiles(null)).toEqual([]);
    expect(extractClipboardImageFiles(undefined)).toEqual([]);
  });

  test('reads images from the files list', () => {
    const file = imageFile();
    expect(extractClipboardImageFiles({ files: [file] })).toEqual([file]);
  });

  test('falls back to entries when only items are exposed', () => {
    const file = imageFile();
    expect(extractClipboardImageFiles({ files: [], items: [fileItem(file)] })).toEqual([file]);
  });

  test('does not return the same image twice when both files and items are present', () => {
    const file = imageFile();
    expect(extractClipboardImageFiles({ files: [file], items: [fileItem(file)] })).toEqual([file]);
  });

  test('ignores non-image entries', () => {
    const text = new File(['note'], 'note.txt', { type: 'text/plain' });
    expect(extractClipboardImageFiles({ files: [text] })).toEqual([]);
    expect(
      extractClipboardImageFiles({ items: [fileItem(null, 'string'), fileItem(text)] })
    ).toEqual([]);
  });

  test('passes through image types the form itself will reject, so the user sees why', () => {
    // Filtering to PNG/JPEG/WebP belongs to the form's validation, which reports a reason.
    // Dropping an SVG silently here would look like the paste did nothing at all.
    const svg = imageFile('vector.svg', 'image/svg+xml');
    expect(extractClipboardImageFiles({ files: [svg] })).toEqual([svg]);
  });
});

describe('clipboardHasText', () => {
  test('a screenshot-only paste carries no text', () => {
    expect(clipboardHasText({ types: ['Files'] })).toBe(false);
  });

  test('a mixed paste from a web page carries text', () => {
    expect(
      clipboardHasText({ types: ['text/plain', 'Files'], getData: () => 'selected words' })
    ).toBe(true);
  });

  test('an advertised but empty text flavour is not text', () => {
    expect(clipboardHasText({ types: ['text/plain', 'Files'], getData: () => '' })).toBe(false);
  });

  test('no clipboard means no text', () => {
    expect(clipboardHasText(null)).toBe(false);
  });
});
