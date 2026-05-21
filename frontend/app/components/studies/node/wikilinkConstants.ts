/**
 * Single source of truth for the wikilink chip. Read-mode (MarkdownDisplay),
 * edit-mode (tiptap node renderHTML), the markdown-it parse rule, and the
 * NotePreviewProvider click delegator all import from here — keeping chip
 * appearance, attribute name, link prefix, and id regex aligned in one
 * place. Drifting any of these in isolation silently breaks one rendering
 * mode while leaving the others fine.
 */

export const STUDIES_LINK_PREFIX = '/studies/';
export const WIKILINK_DATA_ATTR = 'data-wikilink-id';
export const WIKILINK_SELECTOR = 'a[data-wikilink-id]';
export const WIKILINK_CHIP_GLYPH = '●';

export const WIKILINK_CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50';

/**
 * Valid wikilink id: alphanumeric + `_-`. Aligned with Firestore doc-id
 * shape used by study notes. **Must match** the patterns embedded in
 * `WIKI_LINK_PATTERN` / `WIKILINK_MARKDOWN_PATTERN` / `WIKILINK_INPUT_RULE`.
 */
export const WIKILINK_ID_REGEX_SOURCE = '[A-Za-z0-9_-]+';

const VALID_WIKILINK_ID = new RegExp(`^${WIKILINK_ID_REGEX_SOURCE}$`);

/**
 * Validates a wikilink id pulled from an untrusted source (DOM attribute,
 * pasted markdown, etc.). Rejects path traversal and other shenanigans
 * before the id reaches the modal or a fetch call.
 */
export function isValidWikilinkId(value: string | null | undefined): value is string {
  return typeof value === 'string' && VALID_WIKILINK_ID.test(value);
}
