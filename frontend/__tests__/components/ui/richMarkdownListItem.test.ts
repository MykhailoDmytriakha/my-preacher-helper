import { Editor } from '@tiptap/core';
import { ListItem } from '@tiptap/extension-list';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';

import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

const markdownOf = (editor: Editor) => (editor.storage as unknown as {
  markdown: { getMarkdown(): string };
}).markdown.getMarkdown();

const fixtures = [
  ['bullet code', 'codeBlock', '- ```\n  # Code in item\n  ```'],
  ['ordered code', 'codeBlock', '3. ```js\n   const a = 1;\n   ```'],
  ['quote', 'blockquote', '- > Quoted words'],
  ['heading', 'heading', '- # Heading'],
  ['nested list', 'bulletList', '- - Nested item'],
  ['horizontal rule', 'horizontalRule', '-\n  ---'],
  ['code in quoted list', 'codeBlock', '> - ```\n>   code\n>   ```'],
  ['code in nested list', 'codeBlock', '- Parent\n  - ```\n    code\n    ```'],
  ['code before another item', 'codeBlock', '- ```\n  code\n  ```\n- Next'],
  ['nested rule', 'horizontalRule', '- Parent\n\n  -\n    ---'],
  ['long fence', 'codeBlock', '- ````\n  ```\n  # Still code\n  ```\n  ````'],
] as const;

describe('list block save and reload (BUG-20261015-list-code-paste-loses-container)', () => {
  it.each(fixtures)('keeps %s inside the same item across repeated saves', (_name, blockType, source) => {
    const first = new Editor({ extensions: richMarkdownExtensions(), content: source });
    const saved = markdownOf(first);
    const second = new Editor({ extensions: richMarkdownExtensions(), content: saved });
    const savedAgain = markdownOf(second);
    const third = new Editor({ extensions: richMarkdownExtensions(), content: savedAgain });
    try {
      let blockInItem = false;
      first.state.doc.descendants((node, _position, parent) => {
        if (node.type.name === blockType && parent?.type.name === 'listItem') blockInItem = true;
      });
      expect(blockInItem).toBe(true);
      expect(first.state.doc.childCount).toBe(1);
      expect(second.getJSON()).toEqual(first.getJSON());
      expect(third.getJSON()).toEqual(first.getJSON());
      expect(savedAgain).toBe(saved);
    } finally {
      first.destroy();
      second.destroy();
      third.destroy();
    }
  });

  it.each([
    '- First\n- Second',
    '- Words  with   spacing',
    '2. First\n3. Second',
    '- First paragraph\n\n  Second paragraph',
    '- Intro\n\n  ```\n  code\n  ```',
    '- Empty sibling follows\n- ',
    '- Before\n\n```\nOutside code\n```',
  ])('keeps ordinary list serialization unchanged for %s', source => {
    const first = new Editor({ extensions: richMarkdownExtensions(), content: source });
    const saved = markdownOf(first);
    const second = new Editor({ extensions: richMarkdownExtensions(), content: saved });
    try {
      expect(second.getJSON()).toEqual(first.getJSON());
      expect(markdownOf(second)).toBe(saved);
    } finally {
      first.destroy();
      second.destroy();
    }
  });
});

it('uses normal HTML whitespace handling in a list paragraph', () => {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: '- Words  with   spacing' });
  try {
    expect(editor.state.doc.textContent).toBe('Words with spacing');
  } finally {
    editor.destroy();
  }
});

it('keeps list indent, outdent and split commands available', () => {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: '- First\n- Second' });
  const selectSecond = () => {
    let position = -1;
    editor.state.doc.descendants((node, offset) => {
      if (node.isText && node.text === 'Second') position = offset + 3;
    });
    expect(position).toBeGreaterThan(0);
    editor.commands.setTextSelection(position);
  };
  try {
    selectSecond();
    expect(editor.commands.sinkListItem('listItem')).toBe(true);
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe('bulletList');
    expect(editor.commands.liftListItem('listItem')).toBe(true);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    selectSecond();
    expect(editor.commands.splitListItem('listItem')).toBe(true);
    const text: string[] = [];
    editor.state.doc.firstChild?.forEach(item => text.push(item.textContent));
    expect(text).toEqual(['First', 'Sec', 'ond']);
  } finally {
    editor.destroy();
  }
});


it.each([
  ['strong', 'bold'],
  ['em', 'italic'],
  ['s', 'strike'],
])('preserves %s formatting inherited from a list ancestor', (tag, mark) => {
  const editor = new Editor({
    extensions: richMarkdownExtensions(),
    content: `<${tag}><ul><li><p>Words</p></li></ul></${tag}>`,
  });
  try {
    let found = false;
    editor.state.doc.descendants(node => {
      if (node.isText && node.text === 'Words') {
        found = true;
        expect(node.marks.map(value => value.type.name)).toEqual([mark]);
      }
    });
    expect(found).toBe(true);
  } finally {
    editor.destroy();
  }
});

it.each([
  ['strong', 'bold'],
  ['em', 'italic'],
  ['s', 'strike'],
])('preserves inherited %s formatting on a block-first list item', (tag, mark) => {
  const editor = new Editor({
    extensions: richMarkdownExtensions(),
    content: `<${tag}><ul><li><blockquote><p>Words</p></blockquote></li></ul></${tag}>`,
  });
  try {
    let found = false;
    editor.state.doc.descendants(node => {
      if (node.type.name !== 'listItem') return;
      expect(node.firstChild?.type.name).toBe('paragraph');
      expect(node.child(1).type.name).toBe('blockquote');
      const text = node.child(1).firstChild?.firstChild;
      expect(text?.text).toBe('Words');
      expect(text?.marks.map(value => value.type.name)).toEqual([mark]);
      found = true;
    });
    expect(found).toBe(true);
    const reloaded = new Editor({ extensions: richMarkdownExtensions(), content: markdownOf(editor) });
    try {
      // Raw inline HTML wrappers can leave empty paragraphs around the list. Markdown
      // intentionally trims those outer blanks; the list content and marks must survive.
      const originalList = editor.state.doc.content.content.find(node => node.type.name === 'bulletList');
      expect(reloaded.state.doc.firstChild?.toJSON()).toEqual(originalList?.toJSON());
    } finally {
      reloaded.destroy();
    }
  } finally {
    editor.destroy();
  }
});


it.each([
  ['strong', 'bold'],
  ['em', 'italic'],
  ['s', 'strike'],
])('keeps native rich HTML paste behavior for %s ancestors', (tag, mark) => {
  const editor = new Editor({ extensions: richMarkdownExtensions() });
  const baseline = new Editor({
    extensions: [...richMarkdownExtensions().filter(extension => extension.name !== 'listItem'), ListItem],
  });
  const html = document.createElement('div');
  html.innerHTML = `<${tag}><ul><li><p>Words</p><blockquote><p>Quoted words</p></blockquote></li></ul></${tag}>`;
  try {
    const actual = ProseMirrorDOMParser.fromSchema(editor.schema).parse(html);
    const expected = ProseMirrorDOMParser.fromSchema(baseline.schema).parse(html);
    expect(actual.toJSON()).toEqual(expected.toJSON());
    const marked: string[] = [];
    actual.descendants(node => {
      if (node.isText) {
        expect(node.marks.map(value => value.type.name)).toEqual([mark]);
        marked.push(node.text!);
      }
    });
    expect(marked).toEqual(['Words', 'Quoted words']);
  } finally {
    editor.destroy();
    baseline.destroy();
  }
});


it.each([
  ['code', '<pre><code>Code</code></pre>', 'codeBlock'],
  ['quote', '<blockquote><p>Quoted</p></blockquote>', 'blockquote'],
  ['heading', '<h2>Heading</h2>', 'heading'],
])('keeps native HTML %s paste inside its list item', (_name, block, type) => {
  const editor = new Editor({ extensions: richMarkdownExtensions() });
  try {
    editor.view.pasteHTML(`<ul><li>${block}</li></ul>`, new Event('paste') as ClipboardEvent);
    let found = false;
    editor.state.doc.descendants((node, _offset, parent) => {
      if (node.type.name === type && parent?.type.name === 'listItem') found = true;
    });
    expect(found).toBe(true);
    const saved = markdownOf(editor);
    const reloaded = new Editor({ extensions: richMarkdownExtensions(), content: saved });
    try {
      let preserved = false;
      reloaded.state.doc.descendants((node, _offset, parent) => {
        if (node.type.name === type && parent?.type.name === 'listItem') preserved = true;
      });
      expect(preserved).toBe(true);
    } finally {
      reloaded.destroy();
    }
  } finally {
    editor.destroy();
  }
});
