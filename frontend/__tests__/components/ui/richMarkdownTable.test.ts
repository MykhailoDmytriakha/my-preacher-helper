// Exercise the actual reader renderer: jest.setup.js stubs these ESM modules in most suites.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { Editor } from '@tiptap/core';
import { render } from '@testing-library/react';
import { createElement } from 'react';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { handleMarkdownPaste } from '@/utils/markdownPaste';

/** BUG-20261028-paste-table-glues-words: tables must stay tables after a rich editor save. */
const TABLE = '| Person | Words |\n| --- | --- |\n| Paul | Grace |';
const expected = [['Person', 'Words'], ['Paul', 'Grace']];
const html = '<table><thead><tr><th>Person</th><th>Words</th></tr></thead><tbody><tr><td>Paul</td><td><strong>Grace</strong></td></tr></tbody></table>';

function editorWith(content: string) {
  return new Editor({ extensions: richMarkdownExtensions(), content });
}

const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
const physicalCells = (table: HTMLTableElement) => [...table.rows].map(row => [...row.cells].map(cell => cell.textContent ?? ''));
function logicalCells(table: HTMLTableElement): string[][] {
  const grid: string[][] = [];
  [...table.rows].forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    [...row.cells].forEach(cell => {
      while (grid[rowIndex][column] !== undefined) column += 1;
      const rowSpan = Math.max(cell.rowSpan, 1);
      const colSpan = Math.max(cell.colSpan, 1);
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ??= [];
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          grid[rowIndex + rowOffset][column + columnOffset] = cell.textContent ?? '';
        }
      }
      column += colSpan;
    });
  });
  return grid.map(row => row.map(cell => cell ?? ''));
}
const matrix = (editor: Editor) => {
  const table = editor.view.dom.querySelector('table');
  return table ? physicalCells(table) : [];
};

/** Read a GFM or raw-HTML table through the same MarkdownDisplay used by the app's readers. */
function cellsInViews(markdown: string): string[][] {
  const view = render(createElement(MarkdownDisplay, { content: markdown }));
  const table = view.container.querySelector('table');
  const cells = table ? physicalCells(table) : [];
  view.unmount();
  return cells;
}

/** The browser's paste event carries both clipboard formats; jsdom has no ClipboardEvent. */
function paste(editor: Editor, flavours: { text?: string; html?: string }) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  event.clipboardData = {
    types: [flavours.text === undefined ? null : 'text/plain', flavours.html === undefined ? null : 'text/html'].filter(Boolean),
    getData: (type: string) => (type === 'text/plain' ? flavours.text ?? '' : type === 'text/html' ? flavours.html ?? '' : ''),
  };
  editor.view.dom.dispatchEvent(event);
}

function pastePlainMarkdown(editor: Editor, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (kind: string) => kind === 'text/plain' ? text : '' },
  });
  editor.view.dom.dispatchEvent(event);
}

function tableInView(markdown: string) {
  const view = render(createElement(MarkdownDisplay, { content: markdown }));
  const table = view.container.querySelector('table');
  if (!(table instanceof HTMLTableElement)) {
    view.unmount();
    throw new Error('MarkdownDisplay did not render a table');
  }
  return { table, unmount: view.unmount };
}

describe('retained table cells (BUG-20261028-paste-table-glues-words)', () => {
  it('opens a saved Markdown table with its actual row and column boundaries in the editor and reader', () => {
    const editor = editorWith(TABLE);
    try {
      expect(matrix(editor)).toEqual(expected);
      expect(cellsInViews(TABLE)).toEqual(expected);
    } finally { editor.destroy(); }
  });

  it('keeps table cell boundaries after a cell edit, with unchanged surrounding prose', () => {
    const editor = editorWith(`Before\n\n${TABLE}\n\nAfter`);
    let afterGrace = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text?.includes('Grace')) afterGrace = position + node.text.indexOf('Grace') + 'Grace'.length;
    });
    expect(afterGrace).toBeGreaterThan(0);
    editor.commands.insertContentAt(afterGrace, '!');
    const saved = markdownOf(editor);
    editor.destroy();

    const reopened = editorWith(saved);
    const resaved = markdownOf(reopened);
    try {
      expect(matrix(reopened)).toEqual([['Person', 'Words'], ['Paul', 'Grace!']]);
      expect(cellsInViews(saved)).toEqual([['Person', 'Words'], ['Paul', 'Grace!']]);
      expect(saved).toBe(`Before\n\n| Person | Words |\n| --- | --- |\n| Paul | Grace! |\n\nAfter`);
      expect(cellsInViews(resaved)).toEqual([['Person', 'Words'], ['Paul', 'Grace!']]);
    } finally { reopened.destroy(); }
  });

  it('keeps table cells intact when editing the end of the document after the table', () => {
    const editor = editorWith(`Before\n\n${TABLE}\n\nAfter`);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    const saved = markdownOf(editor);
    editor.destroy();

    const reopened = editorWith(saved);
    try {
      expect(saved).toBe(`Before\n\n${TABLE}\n\nAfter!`);
      expect(matrix(reopened)).toEqual(expected);
      expect(cellsInViews(saved)).toEqual(expected);
      expect(markdownOf(reopened)).toBe(saved);
    } finally { reopened.destroy(); }
  });

  it('keeps a native rich HTML table paste as cells and preserves emphasis', () => {
    const editor = editorWith('');
    try {
      editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
      expect(matrix(editor)).toEqual(expected);
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Grace');
    } finally { editor.destroy(); }
  });

  it('keeps a plain Markdown table paste as separate cells', () => {
    const editor = editorWith('');
    try {
      pastePlainMarkdown(editor, TABLE);
      expect(matrix(editor)).toEqual(expected);
    } finally { editor.destroy(); }
  });

  it('keeps Markdown-source table paste when the clipboard also carries source HTML', () => {
    const editor = editorWith('');
    const data: Record<string, string> = { 'text/plain': TABLE, 'text/html': `<pre>${TABLE}</pre>` };
    const event = { clipboardData: { files: [], getData: (kind: string) => data[kind] ?? '' } } as unknown as ClipboardEvent;
    try {
      expect(handleMarkdownPaste(editor.view, event, editor)).toBe(true);
      expect(matrix(editor)).toEqual(expected);
    } finally { editor.destroy(); }
  });

  it('keeps a pasted table without a header as data cells in the editor and reader', () => {
    const editor = editorWith('');
    paste(editor, {
      text: 'Paul\tGrace\nPeter\tHope',
      html: '<table><tbody><tr><td>Paul</td><td>Grace</td></tr><tr><td>Peter</td><td>Hope</td></tr></tbody></table>',
    });
    const saved = markdownOf(editor);
    const reopened = editorWith(saved);
    try {
      expect(matrix(reopened)).toEqual([['Paul', 'Grace'], ['Peter', 'Hope']]);
      const firstRow = reopened.view.dom.querySelector('table tr');
      expect(firstRow?.querySelectorAll('td')).toHaveLength(2);
      expect(firstRow?.querySelectorAll('th')).toHaveLength(0);
      expect(cellsInViews(saved)).toEqual([['Paul', 'Grace'], ['Peter', 'Hope']]);
      const view = tableInView(saved);
      expect(view.table.rows[0].cells[0].tagName).toBe('TD');
      view.unmount();
    } finally { editor.destroy(); reopened.destroy(); }
  });
});

it.each(['Ordinary words', '- First\n- Second', '```\n| literal | pipe |\n```'])('keeps an ordinary text/list/code control through save and reload: %s', source => {
  const editor = editorWith(source);
  const saved = markdownOf(editor);
  const reopened = editorWith(saved);
  try {
    expect(reopened.getJSON()).toEqual(editor.getJSON());
    expect(reopened.state.doc.textContent).toBe(editor.state.doc.textContent);
  } finally { editor.destroy(); reopened.destroy(); }
});

it('keeps escaped pipes and inline formatting in their cells through repeated saves and reader rendering', () => {
  const source = '| Key | Note |\n| --- | --- |\n| A\\|B | **Grace** and [John](https://example.com) |';
  const first = editorWith(source);
  const second = editorWith(markdownOf(first));
  const third = editorWith(markdownOf(second));
  try {
    for (const editor of [first, second, third]) {
      expect(matrix(editor)).toEqual([['Key', 'Note'], ['A|B', 'Grace and John']]);
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Grace');
      expect(editor.view.dom.querySelector('td a')?.getAttribute('href')).toBe('https://example.com');
    }
    expect(cellsInViews(markdownOf(third))).toEqual([['Key', 'Note'], ['A|B', 'Grace and John']]);
  } finally { first.destroy(); second.destroy(); third.destroy(); }
});

it('keeps rich HTML spans and paragraphs when a table cannot be represented by pipe Markdown', () => {
  const source = '<table><tbody><tr><td colspan="2"><p>Alpha</p><p>Beta</p></td></tr><tr><td>Left</td><td>Right</td></tr></tbody></table>';
  const first = editorWith('');
  first.view.pasteHTML(source, new Event('paste') as ClipboardEvent);
  const saved = markdownOf(first);
  const second = editorWith(saved);
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['AlphaBeta'], ['Left', 'Right']]);
      expect(editor.view.dom.querySelector('td')?.getAttribute('colspan')).toBe('2');
      expect(editor.view.dom.querySelectorAll('td:first-child p')).toHaveLength(3);
    }
    const view = tableInView(saved);
    expect(physicalCells(view.table)).toEqual([['AlphaBeta'], ['Left', 'Right']]);
    expect(view.table.rows[0].cells[0].getAttribute('colspan')).toBe('2');
    expect(view.table.rows[0].cells[0].querySelectorAll('p')).toHaveLength(2);
    view.unmount();
  } finally { first.destroy(); second.destroy(); }
});

it('keeps a table inside its quoted block through save and reload', () => {
  const source = TABLE.split('\n').map(line => `> ${line}`).join('\n');
  const first = editorWith(source);
  const second = editorWith(markdownOf(first));
  try {
    expect(matrix(first)).toEqual(expected);
    expect(matrix(second)).toEqual(expected);
    expect(second.view.dom.querySelector('table')?.closest('blockquote')).not.toBeNull();
    const view = tableInView(markdownOf(second));
    expect(physicalCells(view.table)).toEqual(expected);
    expect(view.table.closest('blockquote')).not.toBeNull();
    view.unmount();
  } finally { first.destroy(); second.destroy(); }
});

it('keeps the explicit paste-as-plain-text escape hatch literal', () => {
  const editor = editorWith('');
  try {
    editor.view.pasteText(TABLE, new Event('paste') as ClipboardEvent);
    expect(matrix(editor)).toEqual([]);
    expect(editor.state.doc.textContent).toContain('| Person | Words |');
  } finally { editor.destroy(); }
});

it('keeps a literal pipe in inline code inside a cell through repeated saves', () => {
  const source = '| Key | Note |\n| --- | --- |\n| Paul | `A\\|B` |';
  const first = editorWith(source);
  const second = editorWith(markdownOf(first));
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['Key', 'Note'], ['Paul', 'A|B']]);
      expect(editor.view.dom.querySelector('td code')?.textContent).toBe('A|B');
    }
    expect(cellsInViews(markdownOf(second))).toEqual([['Key', 'Note'], ['Paul', 'A|B']]);
  } finally { first.destroy(); second.destroy(); }
});

it.each(['blockquote', 'li'])('keeps a rich HTML table inside its %s across save and reopen', container => {
  const rich = '<table><tbody><tr><td colspan="2"><p>Alpha</p><p><strong>Beta</strong></p></td></tr><tr><td>Left<br>Below</td><td>Right</td></tr></tbody></table>';
  const wrapped = container === 'li' ? `<ul><li>${rich}</li></ul>` : `<blockquote>${rich}</blockquote>`;
  const first = editorWith(wrapped);
  const second = editorWith(markdownOf(first));
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['AlphaBeta'], ['LeftBelow', 'Right']]);
      expect(editor.view.dom.querySelector('table')?.closest(container)).not.toBeNull();
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Beta');
      expect(editor.view.dom.querySelector('td br')).not.toBeNull();
      expect(editor.view.dom.querySelector('td')?.getAttribute('colspan')).toBe('2');
    }
    const view = tableInView(markdownOf(second));
    expect(physicalCells(view.table)).toEqual([['AlphaBeta'], ['LeftBelow', 'Right']]);
    expect(view.table.closest(container)).not.toBeNull();
    expect(view.table.querySelector('td strong')?.textContent).toBe('Beta');
    expect(view.table.querySelector('td br')).not.toBeNull();
    view.unmount();
  } finally { first.destroy(); second.destroy(); }
});

it('retains empty cells while keeping an ordinary representable table as pipe Markdown', () => {
  const first = editorWith('| | Note |\n| --- | --- |\n| Paul | |');
  const saved = markdownOf(first);
  const second = editorWith(saved);
  try {
    expect(saved).toContain('| --- | --- |');
    expect(matrix(first)).toEqual([['', 'Note'], ['Paul', '']]);
    expect(matrix(second)).toEqual(matrix(first));
    expect(cellsInViews(saved)).toEqual([['', 'Note'], ['Paul', '']]);
  } finally { first.destroy(); second.destroy(); }
});

it('retains a link target containing a literal pipe through editor and reader roundtrips', () => {
  const source = '<table><thead><tr><th>Key</th><th>Note</th></tr></thead><tbody><tr><td>Paul</td><td><a href="https://example.com/a|b">Grace</a></td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const second = editorWith(saved);
  try {
    expect(matrix(second)).toEqual([['Key', 'Note'], ['Paul', 'Grace']]);
    const editorHref = second.view.dom.querySelector('td a')?.getAttribute('href');
    expect(['https://example.com/a|b', 'https://example.com/a%7Cb']).toContain(editorHref);
    expect(cellsInViews(saved)).toEqual([['Key', 'Note'], ['Paul', 'Grace']]);
    const view = tableInView(saved);
    const href = view.table.querySelector('td a')?.getAttribute('href');
    expect(['https://example.com/a|b', 'https://example.com/a%7Cb']).toContain(href);
    view.unmount();
  } finally { first.destroy(); second.destroy(); }
});

it.each([
  ['grace | mercy', 'grace | mercy'],
  ['a\\|b', 'a\\|b'],
  ['a\\\\|b', 'a\\\\|b'],
])('preserves literal pipe content and preceding backslashes across editor and reader saves: %s', (cellText, expectedText) => {
  const source = `Before\n\n<table><thead><tr><th>Cell</th></tr></thead><tbody><tr><td>${cellText}</td></tr></tbody></table>\n\nAfter`;
  const first = editorWith(source);
  const saved = markdownOf(first);
  const second = editorWith(saved);
  const resaved = markdownOf(second);
  try {
    expect(matrix(first)).toEqual([['Cell'], [expectedText]]);
    expect(matrix(second)).toEqual(matrix(first));
    expect(cellsInViews(saved)).toEqual(matrix(first));
    expect(cellsInViews(resaved)).toEqual(matrix(first));
    expect(saved).toContain('Before');
    expect(saved).toContain('After');
  } finally { first.destroy(); second.destroy(); }
});

it('keeps list items as list items within a cell through save and reopening in both readers', () => {
  const source = '<table><thead><tr><th>Who</th><th>What</th></tr></thead><tbody><tr><td>Paul</td><td><ul><li>Grace</li><li>and peace</li></ul></td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const reopened = editorWith(saved);
  try {
    expect(matrix(reopened)).toEqual([['Who', 'What'], ['Paul', 'Graceand peace']]);
    const editorList = reopened.view.dom.querySelector('td ul');
    expect([...editorList?.querySelectorAll('li') ?? []].map(item => item.textContent)).toEqual(['Grace', 'and peace']);
    expect(cellsInViews(saved)).toEqual([['Who', 'What'], ['Paul', 'Graceand peace']]);
    const view = tableInView(saved);
    expect([...view.table.querySelectorAll('td ul li')].map(item => item.textContent)).toEqual(['Grace', 'and peace']);
    expect(view.table.querySelector('td ul')).not.toBeNull();
    view.unmount();
  } finally { first.destroy(); reopened.destroy(); }
});

it('keeps a row-spanned cell and the following row under the right logical heading', () => {
  const source = '<table><thead><tr><th>Person</th><th>Words</th></tr></thead><tbody><tr><td rowspan="2">Paul</td><td>Grace</td></tr><tr><td>Hope</td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const reopened = editorWith(saved);
  try {
    for (const table of [first.view.dom.querySelector('table'), reopened.view.dom.querySelector('table')]) {
      expect(table).not.toBeNull();
      const rows = [...table!.rows];
      expect(rows[1].cells[0].textContent).toBe('Paul');
      expect(rows[1].cells[0].rowSpan).toBe(2);
      expect([...rows[2].cells].map(cell => cell.textContent)).toEqual(['Hope']);
      expect(rows[2].cells).toHaveLength(1);
      expect(logicalCells(table!)).toEqual([['Person', 'Words'], ['Paul', 'Grace'], ['Paul', 'Hope']]);
    }
    const view = tableInView(saved);
    const rows = [...view.table.rows];
    expect(rows[1].cells[0].rowSpan).toBe(2);
    expect([...rows[2].cells].map(cell => cell.textContent)).toEqual(['Hope']);
    expect(logicalCells(view.table)).toEqual([['Person', 'Words'], ['Paul', 'Grace'], ['Paul', 'Hope']]);
    view.unmount();
  } finally { first.destroy(); reopened.destroy(); }
});

it('keeps hard breaks and separate paragraphs within cells through save, reopen, and reading', () => {
  const source = '<table><thead><tr><th>Who</th><th>What</th></tr></thead><tbody><tr><td><p>Paul<br>apostle</p><p>sent to teach</p></td><td><p>Grace</p><p>and peace</p></td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const reopened = editorWith(saved);
  try {
    expect(matrix(reopened)).toEqual([['Who', 'What'], ['Paulapostlesent to teach', 'Graceand peace']]);
    const editorCell = reopened.view.dom.querySelector('td');
    expect(editorCell?.querySelector('br')).not.toBeNull();
    expect([...editorCell?.querySelectorAll('p') ?? []].map(paragraph => paragraph.textContent)).toEqual(['Paulapostle', 'sent to teach']);
    expect(cellsInViews(saved)).toEqual([['Who', 'What'], ['Paulapostlesent to teach', 'Graceand peace']]);
    const view = tableInView(saved);
    const viewCell = view.table.querySelector('td');
    expect(viewCell?.querySelector('br')).not.toBeNull();
    expect([...viewCell?.querySelectorAll('p') ?? []].map(paragraph => paragraph.textContent)).toEqual(['Paulapostle', 'sent to teach']);
    view.unmount();
  } finally { first.destroy(); reopened.destroy(); }
});

it('preserves a pipe link target, tooltip backslash, and underlined words through both renderers', () => {
  const source = '<table><thead><tr><th>Link</th><th>Underlined</th><th>Words</th></tr></thead><tbody><tr><td><a href="https://example.com/a|b" title="Grace\\|mercy">https://example.com/a|b</a></td><td><u>c|d</u></td><td>Important words</td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const reopened = editorWith(saved);
  try {
    const rows = [['Link', 'Underlined', 'Words'], ['https://example.com/a|b', 'c|d', 'Important words']];
    expect(matrix(reopened)).toEqual(rows);
    expect(cellsInViews(saved)).toEqual(rows);
    const editorLink = reopened.view.dom.querySelector('td a');
    expect([editorLink?.getAttribute('href'), 'https://example.com/a%7Cb']).toContain('https://example.com/a|b');
    expect(editorLink?.getAttribute('title')).toBe('Grace\\|mercy');
    expect(reopened.view.dom.querySelector('td u')?.textContent).toBe('c|d');
    const view = tableInView(saved);
    const link = view.table.querySelector('td a');
    expect([link?.getAttribute('href'), 'https://example.com/a%7Cb']).toContain('https://example.com/a|b');
    expect(link?.getAttribute('title')).toBe('Grace\\|mercy');
    expect(view.table.querySelector('td u')?.textContent).toBe('c|d');
    view.unmount();
  } finally { first.destroy(); reopened.destroy(); }
});

it('keeps every letter after code pipes when bold, italic, and strike marks follow', () => {
  const source = '<table><thead><tr><th>Cell</th><th>Words</th></tr></thead><tbody><tr><td><code>a||||||b</code><strong>Grace</strong> <em>and</em> <s>peace</s></td><td>Important words</td></tr></tbody></table>';
  const first = editorWith(source);
  const saved = markdownOf(first);
  const reopened = editorWith(saved);
  try {
    const rows = [['Cell', 'Words'], ['a||||||bGrace and peace', 'Important words']];
    expect(matrix(reopened)).toEqual(rows);
    expect(cellsInViews(saved)).toEqual(rows);
    expect(reopened.view.dom.querySelector('td code')?.textContent).toBe('a||||||b');
    expect(reopened.view.dom.querySelector('td strong')?.textContent).toBe('Grace');
    expect(reopened.view.dom.querySelector('td em')?.textContent).toBe('and');
    expect(reopened.view.dom.querySelector('td s')?.textContent).toBe('peace');
    const view = tableInView(saved);
    expect(view.table.querySelector('td code')?.textContent).toBe('a||||||b');
    expect(view.table.querySelector('td strong')?.textContent).toBe('Grace');
    expect(view.table.querySelector('td em')?.textContent).toBe('and');
    expect(view.table.querySelector('td del, td s')?.textContent).toBe('peace');
    view.unmount();
  } finally { first.destroy(); reopened.destroy(); }
});
