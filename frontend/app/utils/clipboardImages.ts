/**
 * Reading images out of a paste.
 *
 * A screenshot on the clipboard is not text — the OS puts the bitmap itself there, and the browser
 * hands it to a paste handler as a file entry. So "attach on Ctrl+V" is nothing more than reading
 * those entries; the same code path then validates them exactly like a picked file.
 */

/** The slice of `DataTransfer` a paste handler actually needs — keeps this testable without jsdom. */
export interface ClipboardLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<DataTransferItem> | null;
  types?: ArrayLike<string> | null;
  getData?: (format: string) => string;
}

export function extractClipboardImageFiles(
  clipboard: ClipboardLike | null | undefined
): File[] {
  if (!clipboard) return [];

  // `files` and `items` describe the same payload; `files` is the direct list, `items` is the
  // fallback for clipboards that only expose entries. Reading both would duplicate every image.
  const fromFiles = Array.from(clipboard.files ?? []);
  const candidates = fromFiles.length
    ? fromFiles
    : Array.from(clipboard.items ?? [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);

  return candidates.filter(file => typeof file.type === 'string' && file.type.startsWith('image/'));
}

/**
 * True when the paste also carries text worth keeping. Copying a region of a web page yields text
 * *and* an image; swallowing the paste there would silently drop what the user actually selected.
 */
export function clipboardHasText(clipboard: ClipboardLike | null | undefined): boolean {
  if (!clipboard) return false;
  if (!Array.from(clipboard.types ?? []).includes('text/plain')) return false;

  // Some clipboards advertise an empty text flavour next to an image; that is not text to keep.
  const text = clipboard.getData?.('text/plain');
  return text === undefined || text.length > 0;
}
