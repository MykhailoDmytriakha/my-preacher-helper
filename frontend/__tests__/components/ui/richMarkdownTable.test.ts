import { Editor } from '@tiptap/core';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { handleMarkdownPaste } from '@/utils/markdownPaste';

const source = '| Person | Words |\n| --- | --- |\n| Paul | Grace |';
const html = '<table><thead><tr><th>Person</th><th>Words</th></tr></thead><tbody><tr><td>Paul</td><td><strong>Grace</strong></td></tr></tbody></table>';
const matrix = (editor: Editor) => [...editor.view.dom.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent));
const expected = [['Person', 'Words'], ['Paul', 'Grace']];

const pastePlainMarkdown = (editor: Editor, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (kind: string) => kind === 'text/plain' ? text : '' },
  });
  editor.view.dom.dispatchEvent(event);
};
const markdown = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

describe('retained table cells (BUG-20261028-paste-table-glues-words)', () => {
  it('opens a saved Markdown table with its actual row and column boundaries', () => {
    const editor = new Editor({ extensions: richMarkdownExtensions(), content: source });
    try { expect(matrix(editor)).toEqual(expected); } finally { editor.destroy(); }
  });
  it('keeps table cell boundaries after an edit and reopening the saved Markdown', () => {
    const editor = new Editor({ extensions: richMarkdownExtensions(), content: source });
    let afterGrace = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text?.includes('Grace')) afterGrace = position + node.text.indexOf('Grace') + 'Grace'.length;
    });
    expect(afterGrace).toBeGreaterThan(0);
    editor.commands.insertContentAt(afterGrace, '!');
    const saved = markdown(editor);
    const reopened = new Editor({ extensions: richMarkdownExtensions(), content: saved });
    try {
      expect(matrix(reopened)).toEqual([['Person', 'Words'], ['Paul', 'Grace!']]);
      expect(saved).not.toContain('PersonWordsPaulGrace');
    } finally { editor.destroy(); reopened.destroy(); }
  });
  it('keeps a native rich HTML table paste as cells and preserves its emphasis', () => {
    const editor = new Editor({ extensions: richMarkdownExtensions() });
    try {
      editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
      expect(matrix(editor)).toEqual(expected);
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Grace');
    } finally { editor.destroy(); }
  });
  it('keeps a plain Markdown table paste as separate cells', () => {
    const editor = new Editor({ extensions: richMarkdownExtensions() });
    try {
      pastePlainMarkdown(editor, source);
      expect(matrix(editor)).toEqual(expected);
    } finally { editor.destroy(); }
  });
  it('keeps Markdown-source table paste when the clipboard also carries source HTML', () => {
    const editor = new Editor({ extensions: richMarkdownExtensions() });
    const data: Record<string, string> = { 'text/plain': source, 'text/html': '<pre>' + source + '</pre>' };
    const event = { clipboardData: { files: [], getData: (kind: string) => data[kind] ?? '' } } as unknown as ClipboardEvent;
    try { expect(handleMarkdownPaste(editor.view, event, editor)).toBe(true); expect(matrix(editor)).toEqual(expected); }
    finally { editor.destroy(); }
  });
});

it.each(['Ordinary words', '- First\n- Second', '```\n| literal | pipe |\n```'])('keeps an ordinary text/list/code control through save and reload: %s', source => {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: source });
  const reopened = new Editor({ extensions: richMarkdownExtensions(), content: markdown(editor) });
  try { expect(reopened.getJSON()).toEqual(editor.getJSON()); expect(reopened.state.doc.textContent).toBe(editor.state.doc.textContent); }
  finally { editor.destroy(); reopened.destroy(); }
});

it('keeps escaped pipes and inline formatting within their own cells through repeated saves', () => {
  const source = '| Key | Note |\n| --- | --- |\n| A\\|B | **Grace** and [John](https://example.com) |';
  const first = new Editor({ extensions: richMarkdownExtensions(), content: source });
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  const third = new Editor({ extensions: richMarkdownExtensions(), content: markdown(second) });
  try {
    for (const editor of [first, second, third]) {
      expect(matrix(editor)).toEqual([['Key', 'Note'], ['A|B', 'Grace and John']]);
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Grace');
      expect(editor.view.dom.querySelector('td a')?.getAttribute('href')).toBe('https://example.com');
    }
  } finally { first.destroy(); second.destroy(); third.destroy(); }
});

it('keeps rich HTML cell spans and paragraphs when the shape needs HTML rather than a pipe table', () => {
  const first = new Editor({ extensions: richMarkdownExtensions() });
  first.view.pasteHTML('<table><tbody><tr><td colspan="2"><p>Alpha</p><p>Beta</p></td></tr><tr><td>Left</td><td>Right</td></tr></tbody></table>', new Event('paste') as ClipboardEvent);
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['AlphaBeta'], ['Left', 'Right']]);
      expect(editor.view.dom.querySelector('td')?.getAttribute('colspan')).toBe('2');
      expect(editor.view.dom.querySelectorAll('td:first-child p')).toHaveLength(3);
    }
  } finally { first.destroy(); second.destroy(); }
});

it('keeps a table inside its quoted block through save and reload', () => {
  const first = new Editor({ extensions: richMarkdownExtensions(), content: source.split('\n').map(line => '> ' + line).join('\n') });
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  try {
    expect(matrix(first)).toEqual(expected);
    expect(matrix(second)).toEqual(expected);
    expect(second.view.dom.querySelector('table')?.closest('blockquote')).not.toBeNull();
  } finally { first.destroy(); second.destroy(); }
});

it('keeps the explicit paste-as-plain-text escape hatch literal', () => {
  const editor = new Editor({ extensions: richMarkdownExtensions() });
  try {
    editor.view.pasteText(source, new Event('paste') as ClipboardEvent);
    expect(matrix(editor)).toEqual([]);
    expect(editor.state.doc.textContent).toContain('| Person | Words |');
  } finally { editor.destroy(); }
});

it('keeps a literal pipe in inline code inside a cell through repeated saves', () => {
  const first = new Editor({ extensions: richMarkdownExtensions(), content: '| Key | Note |\n| --- | --- |\n| Paul | `A\\|B` |' });
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['Key', 'Note'], ['Paul', 'A|B']]);
      expect(editor.view.dom.querySelector('td code')?.textContent).toBe('A|B');
    }
  } finally { first.destroy(); second.destroy(); }
});

it.each(['blockquote', 'li'])('keeps a rich HTML table inside its %s across save and reopen', container => {
  const rich = '<table><tbody><tr><td colspan="2"><p>Alpha</p><p><strong>Beta</strong></p></td></tr><tr><td>Left<br>Below</td><td>Right</td></tr></tbody></table>';
  const wrapped = container === 'li' ? '<ul><li>' + rich + '</li></ul>' : '<blockquote>' + rich + '</blockquote>';
  const first = new Editor({ extensions: richMarkdownExtensions(), content: wrapped });
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  try {
    for (const editor of [first, second]) {
      expect(matrix(editor)).toEqual([['AlphaBeta'], ['LeftBelow', 'Right']]);
      expect(editor.view.dom.querySelector('table')?.closest(container)).not.toBeNull();
      expect(editor.view.dom.querySelector('td strong')?.textContent).toBe('Beta');
      expect(editor.view.dom.querySelector('td br')).not.toBeNull();
      expect(editor.view.dom.querySelector('td')?.getAttribute('colspan')).toBe('2');
    }
  } finally { first.destroy(); second.destroy(); }
});

it('retains empty cells while keeping an ordinary representable table as pipe Markdown', () => {
  const first = new Editor({ extensions: richMarkdownExtensions(), content: '| | Note |\n| --- | --- |\n| Paul | |' });
  const saved = markdown(first);
  const second = new Editor({ extensions: richMarkdownExtensions(), content: saved });
  try {
    expect(saved).toContain('| --- | --- |');
    expect(matrix(first)).toEqual([['', 'Note'], ['Paul', '']]);
    expect(matrix(second)).toEqual(matrix(first));
  } finally { first.destroy(); second.destroy(); }
});

it('retains a link target containing a literal pipe without splitting its cell', () => {
  const first = new Editor({ extensions: richMarkdownExtensions(), content: '<table><thead><tr><th>Key</th><th>Note</th></tr></thead><tbody><tr><td>Paul</td><td><a href="https://example.com/a|b">Grace</a></td></tr></tbody></table>' });
  const second = new Editor({ extensions: richMarkdownExtensions(), content: markdown(first) });
  try {
    expect(matrix(second)).toEqual([['Key', 'Note'], ['Paul', 'Grace']]);
    expect(second.view.dom.querySelector('td a')?.getAttribute('href')).toBe('https://example.com/a|b');
  } finally { first.destroy(); second.destroy(); }
});
