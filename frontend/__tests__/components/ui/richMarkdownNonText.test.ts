import { Editor } from '@tiptap/core';
import { joinBackward } from '@tiptap/pm/commands';

import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

const open = (content: string) => new Editor({ extensions: richMarkdownExtensions(), content });
const markdown = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

it('protects an invisible comment from Backspace at the next paragraph', () => {
  const source = 'First paragraph.\n\n<!-- Keep this even when it is hidden. -->\n\nSecond paragraph.';
  const editor = open(source);
  try {
    editor.commands.setTextSelection(editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1);
    expect(joinBackward(editor.state, editor.view.dispatch)).toBe(true);
    expect(markdown(editor)).toBe(source);
    editor.commands.setContent('A different supplied value.', { emitUpdate: false });
    expect(markdown(editor)).toBe('A different supplied value.');
  } finally {
    editor.destroy();
  }
});

it('retains the HTML table shape when a cell has a multiline comment and an image', () => {
  const comment = '<!-- first line\nsecond line -->';
  const image = '<img src="/image with spaces.png" alt="Example">';
  const source = '<table><tbody><tr><th><p>Notes</p></th></tr><tr><td><p>Text ' + comment + ' ' + image + '</p></td></tr></tbody></table>';
  const editor = open(source);
  try {
    const saved = markdown(editor);
    expect(saved).toMatch(/<table(?:\s|>)/);
    expect(saved).toContain(comment);
    expect(saved).toContain(image);
    const reopened = open(saved);
    try { expect(reopened.state.doc.toJSON()).toEqual(editor.state.doc.toJSON()); }
    finally { reopened.destroy(); }
  } finally {
    editor.destroy();
  }
});

it('keeps an image with a spaced address round-trippable and its editing HTML inert', () => {
  const image = '<img src="/image with spaces.png" alt="Example">';
  const editor = open('Before ' + image + ' after.');
  try {
    expect(editor.view.dom.querySelector('img')).toBeNull();
    expect(editor.getHTML()).not.toContain('<img');
    const saved = markdown(editor);
    expect(saved).toContain(image);
    const reopened = open(saved);
    try { expect(reopened.state.doc.toJSON()).toEqual(editor.state.doc.toJSON()); }
    finally { reopened.destroy(); }
  } finally {
    editor.destroy();
  }
});

it('does not convert an authored invalid comment marker into HTML', () => {
  const editor = open('Before <span data-markdown-comment="&gt; extra text"></span> after.');
  try {
    expect(markdown(editor)).not.toContain('<!--');
    expect(markdown(editor)).toContain('Before after.');
  } finally {
    editor.destroy();
  }
});

it('keeps hidden attachments when selected visible prose is replaced', () => {
  const comment = '<!-- Private editorial words -->';
  const image = '![Diagram](/diagram.png)';
  const editor = open('Visible ' + comment + ' words and ' + image + ' for correction.');
  try {
    editor.view.dispatch(editor.state.tr.replaceWith(1, editor.state.doc.content.size - 1,
      editor.schema.text('Corrected visible prose.')));
    expect(editor.state.doc.textContent).toBe('Corrected visible prose.');
    expect(markdown(editor)).toContain(comment);
    expect(markdown(editor)).toContain(image);
  } finally {
    editor.destroy();
  }
});

it.each([
  '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="Diagram">',
  '<img src="/diagram?a=literal&amp;copy;" alt="Diagram" title="Keep &amp;copy;">',
])('reopens the same image metadata from %s', source => {
  const editor = open('Before ' + source + ' after.');
  try {
    const reopened = open(markdown(editor));
    try { expect(reopened.state.doc.toJSON()).toEqual(editor.state.doc.toJSON()); }
    finally { reopened.destroy(); }
  } finally {
    editor.destroy();
  }
});

it.each([
  ['![Fish &amp; chips](/menu.png)', 'Fish & chips'],
  ['![A \\*star\\* and \\[brackets\\]](/menu.png)', 'A *star* and [brackets]'],
  ['![See `code`](/menu.png)', 'See code'],
])('keeps literal alternative text from %s', (source, alt) => {
  const editor = open(source);
  try {
    expect(editor.state.doc.firstChild!.firstChild?.attrs.alt).toBe(alt);
    const reopened = open(markdown(editor));
    try { expect(reopened.state.doc.toJSON()).toEqual(editor.state.doc.toJSON()); }
    finally { reopened.destroy(); }
  } finally {
    editor.destroy();
  }
});

it('keeps the next word bold when deleting visible text before a hidden inline comment', () => {
  const comment = '<!-- Keep inline comment -->';
  const editor = open('Before ' + comment + '**Bold**');
  try {
    editor.view.dispatch(editor.state.tr.delete(1, 8));
    const saved = markdown(editor);
    expect(saved).toContain(comment);
    const reopened = open(saved);
    try {
      expect(reopened.state.doc.textContent).toBe('Bold');
      expect(reopened.state.doc.toJSON()).toEqual(editor.state.doc.toJSON());
    } finally { reopened.destroy(); }
  } finally {
    editor.destroy();
  }
});
