// The real react-markdown and remark-gfm, not the global stubs in jest.setup.js: the views read the saved table with them.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');

import { Editor } from '@tiptap/core';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { escapeCellPipes } from '@/components/ui/markdownTable';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

/**
 * BUG-20261028-paste-table-glues-words: the editor had no table, so a note holding a Markdown table was saved with
 * its cells run together into one word after any edit («PersonWordsPaulGrace!»), and a pasted table the same way.
 * The saved Markdown is the note itself, so what the editor writes back is the whole check.
 */
const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

const TABLE = '| Person | Words |\n| --- | --- |\n| Paul | Grace |';

function editorWith(content: string) {
    return new Editor({ extensions: richMarkdownExtensions(), content });
}

/** The table's cells row by row, as the editor reads saved Markdown back (markdown-it). */
function cellsInEditor(markdown: string): string[][] {
    const editor = editorWith(markdown);
    const rows: string[][] = [];
    editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableRow') rows.push([]);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') rows[rows.length - 1].push(node.textContent);
    });
    editor.destroy();
    return rows;
}

/** The table's cells row by row, as the reading, plan and preaching views show saved Markdown (remark-gfm, micromark). */
function cellsInViews(markdown: string): string[][] {
    const view = render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown));
    const rows = [...view.container.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''));
    view.unmount();
    return rows;
}

/** An ordinary paste, as the browser delivers it: the clipboard's flavours on a paste event (jsdom has no ClipboardEvent). */
function paste(editor: Editor, flavours: { text?: string; html?: string }) {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = {
        types: [flavours.text === undefined ? null : 'text/plain', flavours.html === undefined ? null : 'text/html'].filter(Boolean),
        getData: (type: string) => (type === 'text/plain' ? flavours.text ?? '' : type === 'text/html' ? flavours.html ?? '' : ''),
    };
    editor.view.dom.dispatchEvent(event);
}

describe('a table in the rich Markdown editor', () => {
    it('keeps a table the note already holds when the note is edited', () => {
        const editor = editorWith(`Before\n\n${TABLE}\n\nAfter`);
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
        const saved = markdownOf(editor);
        editor.destroy();

        expect(saved).toBe(`Before\n\n${TABLE}\n\nAfter!`);
    });

    it('writes back the same table, save after save', () => {
        const first = editorWith(TABLE);
        const saved = markdownOf(first);
        first.destroy();
        const again = editorWith(saved);
        const resaved = markdownOf(again);
        again.destroy();

        // A table that ends the note is closed with a line break; it does not grow from save to save.
        expect(saved.trimEnd()).toBe(TABLE);
        expect(resaved).toBe(saved);
    });

    it('turns a pasted Markdown table into a table', () => {
        const editor = editorWith('');
        paste(editor, { text: '| A | B |\n|---|---|\n| 1 | 2 |' });
        const saved = markdownOf(editor);
        editor.destroy();

        expect(saved.trimEnd()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    });

    it('keeps the cells of a pasted table apart, even one without a header row', () => {
        const editor = editorWith('');
        paste(editor, { text: 'Paul\tGrace\nPeter\tHope', html: '<table><tbody><tr><td>Paul</td><td>Grace</td></tr><tr><td>Peter</td><td>Hope</td></tr></tbody></table>' });
        const saved = markdownOf(editor);
        const reopened = editorWith(saved);
        const cells: string[] = [];
        reopened.state.doc.descendants((node) => {
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(node.textContent);
        });
        editor.destroy();
        reopened.destroy();

        expect(saved).not.toContain('PaulGrace');
        expect(cells).toEqual(['Paul', 'Grace', 'Peter', 'Hope']);
        // Written as a Markdown table, not HTML: the plan's reading and preaching views show markup as text.
        expect(saved.trimEnd()).toBe('| Paul | Grace |\n| --- | --- |\n| Peter | Hope |');
    });

    /* A pipe in a cell's words was written unescaped: the next opening split the cell, and the last cell's words were dropped. */
    it('keeps a pipe in a cell\'s words inside that cell, and every cell\'s words', () => {
        const table = '| Word | Meaning |\n| --- | --- |\n| grace \\| mercy | Important words |';
        const first = editorWith(`${table}\n\nAfter`);
        first.commands.insertContentAt(first.state.doc.content.size - 1, '!');
        const saved = markdownOf(first);
        first.destroy();
        const reopened = editorWith(saved);
        const cells: string[] = [];
        reopened.state.doc.descendants((node) => {
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(node.textContent);
        });
        reopened.destroy();

        expect(saved).toBe(`${table}\n\nAfter!`);
        expect(cells).toEqual(['Word', 'Meaning', 'grace | mercy', 'Important words']);
        expect(cellsInViews(saved)).toEqual([['Word', 'Meaning'], ['grace | mercy', 'Important words']]);
    });

    /* Codex review, 2026-10-29: list items in a cell ran together, and a cell merged down two rows moved the next row's words under the first heading. */
    it('keeps the words of list items in a cell apart', () => {
        const editor = editorWith('');
        paste(editor, { text: 'x', html: '<table><tr><th>Who</th><th>What</th></tr><tr><td>Paul</td><td><ul><li>Grace</li><li>and peace</li></ul></td></tr></table>' });
        const saved = markdownOf(editor);
        editor.destroy();

        expect(saved.trimEnd()).toBe('| Who | What |\n| --- | --- |\n| Paul | Grace and peace |');
    });

    it('keeps every word under its heading when a cell is merged down two rows', () => {
        const editor = editorWith('');
        paste(editor, { text: 'x', html: '<table><tr><th>Person</th><th>Words</th></tr><tr><td rowspan="2">Paul</td><td>Grace</td></tr><tr><td>Hope</td></tr></table>' });
        const saved = markdownOf(editor);
        editor.destroy();
        const reopened = editorWith(saved);
        const rows: string[][] = [];
        reopened.state.doc.descendants((node) => {
            if (node.type.name === 'tableRow') rows.push([]);
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') rows[rows.length - 1].push(node.textContent);
        });
        reopened.destroy();

        expect(rows).toEqual([['Person', 'Words'], ['Paul', 'Grace'], ['', 'Hope']]);
    });

    it('keeps a pipe and a backslash written inside code in a cell, read alike by the editor and the views', () => {
        const editor = editorWith('');
        paste(editor, { text: 'x', html: '<table><tr><th>Code</th><th>Also code</th><th>Words</th></tr><tr><td><code>a|b</code></td><td><code>a\\|b</code></td><td>Important words</td></tr></table>' });
        const saved = markdownOf(editor);
        editor.destroy();

        const rows = [['Code', 'Also code', 'Words'], ['a|b', 'a\\|b', 'Important words']];
        expect(cellsInEditor(saved)).toEqual(rows);
        expect(cellsInViews(saved)).toEqual(rows);
    });


    it('keeps a link with a pipe in its address and tooltip as it was, and underlined words with a pipe, read alike', () => {
        // A pasted link keeps no tooltip; one already in the note's text does.
        const editor = editorWith('<table><tr><th>Link</th><th>Underlined</th><th>Words</th></tr><tr><td><a href="https://example.com/a|b" title="Grace\\|mercy">https://example.com/a|b</a></td><td><u>c|d</u></td><td>Important words</td></tr></table>');
        const saved = markdownOf(editor);
        editor.destroy();

        const rows = [['Link', 'Underlined', 'Words'], ['https://example.com/a|b', 'c|d', 'Important words']];
        expect(cellsInEditor(saved)).toEqual(rows);
        expect(cellsInViews(saved)).toEqual(rows);
        const view = render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, saved));
        expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a%7Cb');
        expect(view.container.querySelector('a')?.getAttribute('title')).toBe('Grace\\|mercy');
        view.unmount();
        const reopened = editorWith(saved);
        const titles: unknown[] = [];
        reopened.state.doc.descendants((node) => {
            node.marks.forEach((mark) => { if (mark.type.name === 'link') titles.push(mark.attrs.title); });
        });
        reopened.destroy();
        expect(titles).toEqual(['Grace\\|mercy']);
    });

    /* Backslashes put into the serializer's output moved the positions it tidies bold and italic by: a letter was cut (Codex review, 2026-10-29). */
    it('keeps every letter of a cell where code with pipes stands before bold words', () => {
        const editor = editorWith('');
        paste(editor, { text: 'x', html: '<table><tr><th>Cell</th><th>Words</th></tr><tr><td><code>a||||||b</code><strong>Grace</strong> <em>and</em> <s>peace</s></td><td>Important words</td></tr></table>' });
        const saved = markdownOf(editor);
        editor.destroy();

        const rows = [['Cell', 'Words'], ['a||||||bGrace and peace', 'Important words']];
        expect(cellsInEditor(saved)).toEqual(rows);
        expect(cellsInViews(saved)).toEqual(rows);
    });

    it('keeps the words of a cell with a line break on one line, without markup', () => {
        const editor = editorWith('');
        paste(editor, { text: 'x', html: '<table><tr><th>Who</th><th>What</th></tr><tr><td>Paul<br>apostle</td><td><p>Grace</p><p>and peace</p></td></tr></table>' });
        const saved = markdownOf(editor);
        editor.destroy();

        expect(saved.trimEnd()).toBe('| Who | What |\n| --- | --- |\n| Paul apostle | Grace and peace |');
    });
});

describe('a pipe in the words of a table cell', () => {
    it('gets one backslash more, whatever stands before it — the reader takes exactly one away', () => {
        expect(escapeCellPipes('grace | mercy')).toBe('grace \\| mercy');
        expect(escapeCellPipes('a\\\\|b')).toBe('a\\\\\\|b');
        expect(escapeCellPipes('`a\\|b`')).toBe('`a\\\\|b`');
    });
});
