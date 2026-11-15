import { act, render } from '@testing-library/react';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import React from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { nodes, paragraphs, position, productionDocument, serialize } from '@test-utils/foreignContent';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it.each([
  ['https://example.com\n\nOld tail', 'https://example.com\n\nNew tail'],
  ['Start\n\nTail', 'https://example.com\n\nNew tail'],
  ['https://example.com\n\nOld tail', 'Visit https://example.com\n\nNew tail'],
  ['https://example.com\n\nNew tail', 'Start\n\nTail'],
  ['https://example.com\n\nNew tail', 'https://example.com\n\nOld tail'],
])('matches the whole path including link marks from %s to %s', (before, value) => {
  const change = jest.fn();
  const view = render(<RichMarkdownEditor value={before} onChange={change} />);
  const editor = mountedEditor(view.container);
  let target = editor.state.doc;
  act(() => { target = productionDocument(editor, value); });
  view.rerender(<RichMarkdownEditor value={value} onChange={change} />);
  expect(editor.state.doc.eq(target)).toBe(true);
  expect(change).not.toHaveBeenCalled();
});

it('dispatches differing runs end to start in one quiet transaction and retires both branches', () => {
  const view = render(<RichMarkdownEditor value={paragraphs} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(position(editor, 'Paragraph 4:', 3)); });
  const dispatch = jest.spyOn(editor.view, 'dispatch');
  const value = paragraphs.replace('Paragraph 2:', 'PHONE 2:').replace('Paragraph 7:', 'PHONE 7:');
  view.rerender(<RichMarkdownEditor value={value} onChange={jest.fn()} />);
  const changed = dispatch.mock.calls.map(([tr]) => tr).filter(tr => tr.docChanged);
  expect(changed).toHaveLength(1);
  expect(changed[0].steps).toHaveLength(2);
  expect(changed[0].steps[0].toJSON().from).toBeGreaterThan(changed[0].steps[1].toJSON().from);
  expect(changed[0].getMeta('addToHistory')).toBe(false);
  expect(changed[0].getMeta('preventUpdate')).toBe(true);
  expect(undoDepth(editor.state) + redoDepth(editor.state)).toBe(0);
});

it.each(['paste', 'split'])('retires structural own history around an inserted arrival after %s', own => {
  const view = render(<RichMarkdownEditor value={'Alpha OWNBEFORE words\n\nTail'} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(7); if (own === 'paste') editor.commands.insertContent('Pasted OWNP\n\nSecond OWNP\n\nThird OWNP'); else editor.commands.splitBlock(); });
  view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
  const content = nodes(editor.state.doc);
  content.splice(1, 0, editor.schema.nodes.paragraph.create(null, editor.schema.text('PHONEARRIVAL alpha beta gamma')));
  const arrived = serialize(editor, editor.schema.nodes.doc.create(null, content));
  view.rerender(<RichMarkdownEditor value={arrived} onChange={jest.fn()} />);
  const snapshot = editor.state.doc;
  act(() => { expect(editor.commands.undo()).toBe(false); expect(editor.commands.redo()).toBe(false); });
  expect(editor.state.doc.eq(snapshot)).toBe(true);
  expect(markdown(editor)).toContain('PHONEARRIVAL alpha beta gamma');
});

it('matches production when mounted props change a far blockquote URL', () => {
  const before = 'First\n\n<blockquote><h2>https://old.example.org</h2><p>3</p></blockquote>\n\nSpacer\n\nWorking';
  const value = before.replace('old.example.org', 'new.example.org');
  const change = jest.fn();
  const view = render(<RichMarkdownEditor value={before} onChange={change} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(position(editor, 'Working', 3)); });
  let target = editor.state.doc;
  act(() => { target = productionDocument(editor, value); });
  view.rerender(<RichMarkdownEditor value={value} onChange={change} />);
  expect(editor.state.doc.eq(target)).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
