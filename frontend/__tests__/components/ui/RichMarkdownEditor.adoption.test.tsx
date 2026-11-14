import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';
import { richMarkdownCorpus } from '@test-utils/richMarkdownCorpus';
jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
afterEach(cleanup);
const table = '| A | B |\n| --- | --- |\n| abcdef | Keep |';
it.each([
  ['delete letters', table, '| A | B |\n| --- | --- |\n| abef | Keep |'],
  ['add word', table, '| A | B |\n| --- | --- |\n| abcdef PHONE | Keep |'],
  ['second cell', table, '| A | B |\n| --- | --- |\n| abcdef | Keep PHONE |'],
  ['change header', table, '| PHONE | B |\n| --- | --- |\n| abcdef | Keep |'],
  ['change table structure', '| Person | Words |\n| --- | --- |\n| Paul | Grace |', '<table><thead><tr><th>Who</th><th>What</th></tr></thead><tbody><tr><td><p>Paul<br>apostle</p><p>sent to teach</p></td><td><p>Grace</p><p>and peace</p></td></tr></tbody></table>'],
  ['remove table column', 'Before\n\n'+table+'\n\nAfter', 'Before\n\n<table><thead><tr><th>Cell</th></tr></thead><tbody><tr><td>grace | mercy</td></tr></tbody></table>\n\nAfter'],
  ['remove colspan', '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">Together</td></tr></table>', '| Person | Words |\n| --- | --- |\n| Paul | Grace |'],
  ['table with footer', table+'\n\nFooter.', '| A | B |\n| --- | --- |\n| abef | Keep |\n\nFooter.'],
  ['list final heading', '- # Alpha', '- # Alpha PHONE'],
  ['code only', '```js\nconst a = 1;\n```', '```js\nconst a = 2;\n```'],
  ['heading only', '# Alpha', '# Alpha PHONE'],
])('C09 fresh editor %s must produce the same Markdown and JSON as production setContent', (name, before, after) => {
  const onChange = jest.fn();
  const view = render(<><RichMarkdownEditor value={before} onChange={onChange} /><RichMarkdownEditor value={before} onChange={jest.fn()} /></>);
  const roots = view.container.querySelectorAll<HTMLElement>('.tiptap');
  const editor = mountedEditor(roots[0].parentElement!); const reference = mountedEditor(roots[1].parentElement!);
  act(() => editor.commands.setTextSelection(4));
  view.rerender(<><RichMarkdownEditor value={markdown(editor)} onChange={onChange} /><RichMarkdownEditor value={before} onChange={jest.fn()} /></>);
  act(() => reference.commands.setContent(after, { emitUpdate: false }));
  view.rerender(<><RichMarkdownEditor value={after} onChange={onChange} /><RichMarkdownEditor value={before} onChange={jest.fn()} /></>);
  const afterJSON = editor.getJSON();
  const beforeTyping = markdown(editor);
  act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Own.'));
  expect(afterJSON).toEqual(reference.getJSON());
  expect(beforeTyping).toBe(markdown(reference));
});

it('C05 compares sampled pairs of corpus documents with setContent including appended trailing nodes', () => {
  const view = render(<><RichMarkdownEditor value="Before." onChange={jest.fn()} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
  const roots = view.container.querySelectorAll<HTMLElement>('.tiptap');
  const editor = mountedEditor(roots[0].parentElement!);
  const reference = mountedEditor(roots[1].parentElement!);
  const sources = richMarkdownCorpus.concat([
    ['unicode', 'Ёж 🙂 שלום á\n\n漢字'], ['empty heading', '# '], ['empty quote', '> '],
    ['tight headings', '# A\n# B'], ['empty table', '<table><tr><td></td></tr></table>'],
    ['tasks', '- [x] one\n- [ ] two'], ['nested quote', '> > One\n>\n> Two'],
    ['breaks', 'One  \nTwo\n\nThree'], ['html', '<p class="test">X</p><div>Y</div>'],
  ]);
  const mismatches: unknown[] = [];
  let pairs = 0;
  for (let i = 0; i < sources.length; i++) for (let j = 0; j < sources.length; j++) {
    if ((i * 31 + j * 17) % 4 !== 0) continue;
    const [fromName, from] = sources[i]; const [toName, to] = sources[j];
    view.rerender(<><RichMarkdownEditor value={from} onChange={jest.fn()} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
    act(() => { reference.commands.setContent(to, { emitUpdate: false }); });
    view.rerender(<><RichMarkdownEditor value={to} onChange={jest.fn()} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
    pairs++;
    if (markdown(editor) !== markdown(reference) || JSON.stringify(editor.getJSON()) !== JSON.stringify(reference.getJSON())) {
      mismatches.push({ fromName, toName, from, to, actual: editor.getJSON(), expected: reference.getJSON(), actualMd: markdown(editor), expectedMd: markdown(reference) });

    }
  }
  expect(pairs).toBe(1370);
  expect(mismatches).toEqual([]);
}, 120000);
