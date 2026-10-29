import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

import { MarkdownSourcePaste } from '@/utils/markdownPaste';

import { MarkdownCodeBlock } from './markdownCodeBlock';
import { MarkdownTable } from './markdownTable';

/** What the rich Markdown editor is made of, apart from its placeholder — one list for the editor and its tests. */
export function richMarkdownExtensions() {
    return [
        // The code block comes separately: its Markdown fence must outgrow the backticks inside.
        StarterKit.configure({ codeBlock: false }),
        MarkdownCodeBlock,
        // A table stays a table. Without it a note holding a Markdown table (pasted, or from an AI pass) was saved with
        // its cells run together into one word after any edit (BUG-20261028-paste-table-glues-words). The table itself
        // comes separately: it is always written back as a Markdown table, a pipe in its words escaped.
        TableKit.configure({ table: false }),
        MarkdownTable,
        // transformPastedText: parse pasted plain-text markdown (e.g. **bold**, # heading)
        // into real formatting instead of inserting literal characters. Only affects
        // text/plain pastes — rich HTML pastes and "paste as plain text" (Ctrl+Shift+V)
        // are left untouched by tiptap-markdown's clipboardTextParser guard.
        Markdown.configure({ transformPastedText: true }),
        // The line above only covers plain-text-only clipboards. Markdown copied from a chat
        // code block or a source editor also carries a text/html flavour, which makes
        // ProseMirror skip tiptap-markdown entirely — this extension covers that case.
        MarkdownSourcePaste,
    ];
}
