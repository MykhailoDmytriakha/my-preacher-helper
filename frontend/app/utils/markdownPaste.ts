import { Extension } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';

/**
 * Why this file exists.
 *
 * `tiptap-markdown` parses pasted markdown through ProseMirror's `clipboardTextParser`,
 * but ProseMirror only reaches that parser when the clipboard has NO `text/html` flavour
 * (prosemirror-view/dist/index.js: `asText = !!text && (plainText || inCode || !html)`).
 *
 * Copying markdown from a chat code block, a `<pre>` on a page, or a source editor puts BOTH
 * `text/plain` and `text/html` on the clipboard, so the markdown path is skipped and the raw
 * `# heading` / `**bold**` characters land in the note verbatim.
 *
 * Fix: intercept the paste, but only for clipboards that are demonstrably *plain source text*
 * carrying markdown syntax. Anything with real HTML structure (an article, a doc, a rendered
 * chat answer) keeps ProseMirror's normal rich paste — dropping that formatting would be a
 * worse bug than the one we are fixing.
 */

/** Block-level markdown syntax — a single match is enough to call the text "markdown source". */
const BLOCK_MARKERS: RegExp[] = [
    /^[ \t]{0,3}#{1,6}[ \t]+\S/m, // # Heading
    /^[ \t]{0,3}>[ \t]?\S/m, // > blockquote
    /^[ \t]*[-*+][ \t]+\S/m, // - bullet list
    /^[ \t]*\d+[.)][ \t]+\S/m, // 1. ordered list
    /^[ \t]{0,3}(?:```|~~~)/m, // ``` fenced code
    /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m, // --- horizontal rule
    /^[ \t]{0,3}\|.*\|[ \t]*$/m, // | table | row |
];

/**
 * Inline syntax that prose practically never produces by accident — one match is enough.
 * (A copy of *rendered* text never contains these: the browser gives "bold", not "**bold**".)
 */
const STRONG_INLINE_MARKERS: RegExp[] = [
    /\*\*[^\s*][^*]*\*\*/, // **bold**
    /__[^\s_][^_]*__/, // __bold__
    /~~[^\s~][^~]*~~/, // ~~strike~~
    /`[^`\n]+`/, // `code`
    /\[[^\]\n]+\]\([^)\s]+\)/, // [link](url)
];

/** Weak syntax — a lone asterisk pair happens in ordinary prose, so require two hits. */
const WEAK_INLINE_MARKERS: RegExp[] = [
    /(?:^|[^*])\*[^\s*][^*\n]*\*(?:[^*]|$)/g, // *italic*
    /(?:^|[^_])_[^\s_][^_\n]*_(?:[^_]|$)/g, // _italic_
];

const MIN_WEAK_HITS = 2;

/**
 * Tags that carry meaning the plain-text flavour cannot express. Their presence means the
 * clipboard holds genuine rich content, so the markdown path must stay out of the way.
 */
const RICH_CONTENT_SELECTOR =
    'h1,h2,h3,h4,h5,h6,strong,b,em,i,u,s,strike,ul,ol,li,blockquote,a,table,img,figure,hr,mark,sub,sup';

/** VS Code tells us what it copied; only prose-ish modes may become markdown. */
const VSCODE_TEXT_MODES = new Set(['markdown', 'mdx', 'plaintext', 'text']);

/**
 * Does this plain text look like markdown SOURCE (as opposed to prose that merely
 * contains a stray asterisk)? One block or strong-inline marker is enough; weak ones need two.
 */
export function looksLikeMarkdownSource(text: string): boolean {
    if (!text || !text.trim()) return false;

    if (BLOCK_MARKERS.some((re) => re.test(text))) return true;
    if (STRONG_INLINE_MARKERS.some((re) => re.test(text))) return true;

    let weakHits = 0;
    for (const re of WEAK_INLINE_MARKERS) {
        re.lastIndex = 0;
        weakHits += text.match(re)?.length ?? 0;
        if (weakHits >= MIN_WEAK_HITS) return true;
    }
    return false;
}

function elementFromString(value: string): HTMLElement {
    // `<body>` wrapper keeps the browser from dropping top-level tags it considers invalid.
    return new window.DOMParser().parseFromString(`<body>${value}</body>`, 'text/html').body;
}

/**
 * Whitespace is dropped entirely before comparing: line-based HTML (a source editor emits one
 * `<div>` per line) carries no newlines in its text content, so only the characters can match.
 */
const compactText = (value: string) => value.replace(/[\s\u00a0]/g, '');

/**
 * Is the HTML flavour just a dressed-up copy of the plain text (a `<pre><code>` block, a source
 * editor's coloured spans) rather than real formatting? Only then may we ignore it.
 */
export function isPlainTextLikeHtml(html: string, text: string): boolean {
    const body = elementFromString(html);
    if (body.querySelector(RICH_CONTENT_SELECTOR)) return false;
    return compactText(body.textContent ?? '') === compactText(text);
}

/**
 * `handlePaste` implementation: turns markdown-source pastes into real formatting even when the
 * clipboard also carries an HTML flavour. Returns `true` only when it handled the paste.
 */
export function handleMarkdownPaste(
    view: EditorView,
    event: ClipboardEvent,
    editor: Editor | null | undefined
): boolean {
    if (!editor) return false;

    const clipboard = event.clipboardData;
    if (!clipboard) return false;

    // A file/image paste is never markdown source.
    if (clipboard.files && clipboard.files.length > 0) return false;

    const text = clipboard.getData('text/plain');
    const html = clipboard.getData('text/html');

    // No HTML flavour → tiptap-markdown's clipboardTextParser already handles it.
    if (!text || !html) return false;

    // "Paste as plain text" (Cmd/Ctrl+Shift+V) must stay literal — same escape hatch as core.
    // `input` is ProseMirror-internal; losing it costs the escape hatch, not correctness.
    if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false;

    // Inside a code block markdown must stay literal too.
    if (view.state.selection.$from.parent.type.spec.code) return false;

    // Code copied from VS Code belongs to StarterKit's language-aware code-block paste.
    const vscodeData = clipboard.getData('vscode-editor-data');
    if (vscodeData) {
        try {
            const mode = (JSON.parse(vscodeData) as { mode?: string }).mode;
            if (mode && !VSCODE_TEXT_MODES.has(mode)) return false;
        } catch {
            return false;
        }
    }

    if (!isPlainTextLikeHtml(html, text)) return false;
    if (!looksLikeMarkdownSource(text)) return false;

    // tiptap-markdown augments editor.storage at runtime but not in the core Storage type.
    const parser = (
        editor.storage as unknown as {
            markdown?: { parser?: { parse: (value: string, options?: { inline?: boolean }) => string } };
        }
    ).markdown?.parser;
    if (!parser) return false;

    // Same pipeline tiptap-markdown uses for plain-text pastes, so both paths agree.
    const parsedElement = elementFromString(parser.parse(text, { inline: true }));

    // Markdown the schema cannot represent (images, with no image node registered) would be
    // dropped outright — worse than leaving the literal syntax for the user to see and fix.
    if (parsedElement.querySelector('img') && !editor.schema.nodes.image) return false;

    const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(parsedElement, {
        preserveWhitespace: true,
        context: view.state.selection.$from,
    });

    const tr = view.state.tr.replaceSelection(slice);
    // Keep the standard paste contract so paste rules and paste-aware plugins still fire.
    tr.setMeta('paste', true);
    tr.setMeta('uiEvent', 'paste');
    view.dispatch(tr.scrollIntoView());
    return true;
}

/**
 * Editor extension carrying the paste handler. Priority is above the default so this runs before
 * other paste handlers, while its explicit VS Code guard hands code pastes back to CodeBlock.
 */
export const MarkdownSourcePaste = Extension.create({
    name: 'markdownSourcePaste',
    priority: 200,

    addProseMirrorPlugins() {
        const { editor } = this;

        return [
            new Plugin({
                key: new PluginKey('markdownSourcePaste'),
                props: {
                    handlePaste: (view, event) =>
                        handleMarkdownPaste(view, event as ClipboardEvent, editor as unknown as Editor),
                },
            }),
        ];
    },
});
