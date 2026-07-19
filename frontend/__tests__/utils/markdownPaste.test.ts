import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

import {
    MarkdownSourcePaste,
    handleMarkdownPaste,
    isPlainTextLikeHtml,
    looksLikeMarkdownSource,
} from '@/utils/markdownPaste';

import type { Transaction } from '@tiptap/pm/state';

describe('looksLikeMarkdownSource', () => {
    it.each([
        ['heading', '# «Такой-то родился там»\n\nПсалом 86 — небольшой псалом.'],
        ['sub heading', 'Вступление\n\n## Что значило быть записанным'],
        ['blockquote', 'Пояснение\n\n> Славное возвещается о тебе, град Божий!'],
        ['bullet list', 'Список:\n\n- первый пункт\n- второй пункт'],
        ['ordered list', 'Порядок:\n\n1. первый\n2. второй'],
        ['fenced code', 'Пример:\n\n```ts\nconst a = 1;\n```'],
        ['horizontal rule', 'Часть первая\n\n---\n\nЧасть вторая'],
        ['bold alone', 'Абзац с **жирным** словом внутри.'],
        ['inline code alone', 'Вызови `npm run build` в терминале.'],
        ['link alone', 'Ссылка [сюда](https://example.org) в тексте.'],
        ['two italics', 'Он сказал *так*, а потом *иначе*.'],
    ])('detects markdown source: %s', (_label, text) => {
        expect(looksLikeMarkdownSource(text)).toBe(true);
    });

    it.each([
        ['empty', ''],
        ['whitespace only', '   \n\n  '],
        ['plain prose', 'Псалом 86 — небольшой псалом о граде Божием. Его тема — рождение и запись.'],
        ['single stray asterisk pair', 'Он сказал *так* и замолчал.'],
        ['dash inside a sentence', 'Родиться в Египте - было немало.'],
        ['numbers with dots', 'В 1. половине дня, а также 2. часть текста.'],
    ])('does not treat as markdown source: %s', (_label, text) => {
        expect(looksLikeMarkdownSource(text)).toBe(false);
    });
});

describe('isPlainTextLikeHtml', () => {
    it('accepts a code-block copy whose text matches the plain flavour', () => {
        expect(isPlainTextLikeHtml('<pre><code># Заголовок</code></pre>', '# Заголовок')).toBe(true);
    });

    it('accepts a source editor copy made of styled spans', () => {
        expect(
            isPlainTextLikeHtml('<div><span style="color:#ccc"># Заголовок</span></div>', '# Заголовок')
        ).toBe(true);
    });

    it('rejects genuine rich content', () => {
        expect(isPlainTextLikeHtml('<h2>Заголовок</h2><p>Текст</p>', 'Заголовок\n\nТекст')).toBe(false);
    });

    it('rejects HTML whose text differs from the plain flavour', () => {
        expect(isPlainTextLikeHtml('<div>совсем другое</div>', '# Заголовок')).toBe(false);
    });
});

/** Real editor: real schema, real tiptap-markdown parser — only the clipboard event is synthetic. */
const makeEditor = () =>
    new Editor({
        element: document.createElement('div'),
        extensions: [StarterKit, Markdown.configure({ transformPastedText: true }), MarkdownSourcePaste],
        content: '',
    });

const makePasteEvent = (
    data: Record<string, string>,
    options: { files?: unknown[] } = {}
): ClipboardEvent =>
    ({
        clipboardData: {
            getData: (type: string) => data[type] ?? '',
            files: options.files ?? [],
        },
    }) as unknown as ClipboardEvent;

describe('handleMarkdownPaste (real editor)', () => {
    let editor: Editor;

    beforeEach(() => {
        editor = makeEditor();
    });

    afterEach(() => {
        editor.destroy();
    });

    const paste = (data: Record<string, string>, options?: { files?: unknown[] }) =>
        handleMarkdownPaste(editor.view, makePasteEvent(data, options), editor);

    it('renders markdown when a code-block copy carries both flavours', () => {
        const markdown = '# Заголовок\n\nАбзац с **жирным** словом.\n\n- пункт один\n- пункт два';

        expect(
            paste({
                'text/plain': markdown,
                'text/html': `<pre><code>${markdown}</code></pre>`,
            })
        ).toBe(true);

        const html = editor.getHTML();
        expect(html).toContain('<h1>Заголовок</h1>');
        expect(html).toContain('<strong>жирным</strong>');
        expect(html).toContain('<ul');
        expect(html).not.toContain('**');
    });

    it('round-trips back to markdown so the stored note keeps its structure', () => {
        const markdown = '## Раздел\n\nТекст со [ссылкой](https://example.org).';

        paste({ 'text/plain': markdown, 'text/html': `<pre><code>${markdown}</code></pre>` });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stored = (editor.storage as any).markdown.getMarkdown();
        expect(stored).toContain('## Раздел');
        expect(stored).toContain('[ссылкой](https://example.org)');
    });

    it('leaves genuine rich content to ProseMirror', () => {
        expect(
            paste({
                'text/plain': 'Заголовок статьи\n\nОбычный абзац.',
                'text/html': '<h2>Заголовок статьи</h2><p>Обычный абзац.</p>',
            })
        ).toBe(false);
        expect(editor.getHTML()).not.toContain('Заголовок статьи');
    });

    it('does not turn formatted prose into a list just because a line starts with a dash', () => {
        const plain = '- Не бойся, — сказал он.\nОна промолчала.';

        expect(
            paste({
                'text/plain': plain,
                'text/html': '<p>- Не бойся, — <strong>сказал</strong> он.</p><p>Она промолчала.</p>',
            })
        ).toBe(false);
    });

    it('hands VS Code code pastes back to the code-block handler', () => {
        expect(
            paste({
                'text/plain': '# comment\nconst sql = `select * from notes`;',
                'text/html': '<div><span># comment</span></div>',
                'vscode-editor-data': '{"version":1,"mode":"typescript"}',
            })
        ).toBe(false);
    });

    it('still converts markdown copied from VS Code', () => {
        expect(
            paste({
                'text/plain': '# Заголовок\n\nтекст',
                'text/html': '<div><span># Заголовок</span></div><div><br></div><div><span>текст</span></div>',
                'vscode-editor-data': '{"version":1,"mode":"markdown"}',
            })
        ).toBe(true);
        expect(editor.getHTML()).toContain('<h1>Заголовок</h1>');
    });

    it('keeps markdown literal when the schema cannot represent it (image)', () => {
        const markdown = '![схема](https://example.org/a.png)';
        expect(editor.schema.nodes.image).toBeUndefined();
        expect(paste({ 'text/plain': markdown, 'text/html': `<pre><code>${markdown}</code></pre>` })).toBe(
            false
        );
    });

    it('ignores clipboards carrying files', () => {
        expect(
            paste(
                { 'text/plain': '# Заголовок', 'text/html': '<pre><code># Заголовок</code></pre>' },
                { files: [{}] }
            )
        ).toBe(false);
    });

    it('defers when there is no HTML flavour (tiptap-markdown already handles it)', () => {
        expect(paste({ 'text/plain': '# Заголовок' })).toBe(false);
    });

    it('keeps markdown literal on "paste as plain text" (shift held)', () => {
        (editor.view as unknown as { input: { shiftKey: boolean } }).input.shiftKey = true;
        expect(
            paste({ 'text/plain': '# Заголовок', 'text/html': '<pre><code># Заголовок</code></pre>' })
        ).toBe(false);
    });

    it('keeps markdown literal inside a code block', () => {
        editor.commands.setContent('<pre><code>x</code></pre>');
        editor.commands.setTextSelection(2);
        expect(editor.state.selection.$from.parent.type.spec.code).toBe(true);
        expect(
            paste({ 'text/plain': '# Заголовок', 'text/html': '<pre><code># Заголовок</code></pre>' })
        ).toBe(false);
    });

    it('marks the transaction as a paste so paste rules keep working', () => {
        const dispatched: Transaction[] = [];
        const original = editor.view.dispatch.bind(editor.view);
        editor.view.dispatch = (tr: Transaction) => {
            dispatched.push(tr);
            original(tr);
        };

        paste({ 'text/plain': '# Заголовок', 'text/html': '<pre><code># Заголовок</code></pre>' });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].getMeta('paste')).toBe(true);
        expect(dispatched[0].getMeta('uiEvent')).toBe('paste');
    });

    it('does nothing without an editor instance', () => {
        expect(
            handleMarkdownPaste(
                editor.view,
                makePasteEvent({ 'text/plain': '# Заголовок', 'text/html': '<pre>x</pre>' }),
                null
            )
        ).toBe(false);
    });
});

describe('MarkdownSourcePaste extension wiring', () => {
    it('is registered on the editor and installs a handlePaste prop', () => {
        const editor = makeEditor();

        expect(editor.extensionManager.extensions.map((extension) => extension.name)).toContain(
            'markdownSourcePaste'
        );
        expect(editor.view.someProp('handlePaste')).toBeDefined();

        editor.destroy();
    });
});
