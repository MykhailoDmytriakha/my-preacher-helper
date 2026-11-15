import { act, render } from '@testing-library/react';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import React from 'react';

import { applyForeignContent, canonicalForeignTarget } from '@/components/ui/foreignContent';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import { position, productionArrival, productionDocument } from '@test-utils/foreignContent';
import { baseSnapshot } from '@test-utils/foreignSelection';
import { mountedEditor } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it('builds the normalized target without live dispatch, update, state mutation or timers', () => {
  const change = jest.fn();
  const view = render(<RichMarkdownEditor value={'https://example.com\n\nTail'} onChange={change} />);
  const editor = mountedEditor(view.container), before = editor.state;
  writeForeignEvidence('plugins', editor.state.plugins.map((plugin, index) => ({ index, key: (plugin as unknown as { key: string }).key, state: !!plugin.spec.state, append: !!plugin.spec.appendTransaction, filter: !!plugin.spec.filterTransaction, view: !!plugin.spec.view, input: !!(plugin.spec as { isInputRules?: boolean }).isInputRules })));
  const dispatch = jest.spyOn(editor.view, 'dispatch');
  const update = jest.fn(); editor.on('update', update);
  const timer = jest.spyOn(globalThis, 'setTimeout');
  const target = canonicalForeignTarget(editor, 'https://example.com\n\n```js\nPHONE\n```');
  expect(dispatch).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
  expect(editor.state).toBe(before);
  expect(target.lastChild!.type.name).toBe('paragraph');
  expect(target.child(0).firstChild!.marks[0].type.name).toBe('link');
  dispatch.mockRestore(); timer.mockRestore();
  act(() => { expect(target.eq(productionDocument(editor, 'https://example.com\n\n```js\nPHONE\n```'))).toBe(true); });
});

it('dispatches exactly production transactions and callbacks when pre-dispatch verification fails', () => {
  const value = 'PHONE first\n\nNear before\n\nKeep\n\nNear after\n\nPHONE last';
  const parents = [jest.fn(), jest.fn()];
  const views = parents.map(parent => render(<RichMarkdownEditor value={'First\n\nNear before\n\nKeep\n\nNear after\n\nLast'} onChange={parent} />));
  const [editor, base] = views.map(view => mountedEditor(view.container));
  act(() => { for (const e of [editor, base]) e.commands.setTextSelection(position(e, 'Keep', 2)); });
  const dispatches = [editor, base].map(e => jest.spyOn(e.view, 'dispatch'));
  const callbacks = [jest.fn(), jest.fn()];
  [editor, base].forEach((e, i) => e.on('transaction', callbacks[i]));
  // Only reject the candidate transaction's comparison with the canonical target.
  const prototype = Object.getPrototypeOf(editor.state.doc);
  const original = prototype.eq;
  let forced = 0;
  const eq = jest.spyOn(prototype, 'eq').mockImplementation(function (this: typeof editor.state.doc, other) {
    if (!forced && this !== other && this.type.name === 'doc' && this.textContent === 'PHONE firstNear beforeKeepNear afterPHONE last') {
      forced++;
      return false;
    }
    return original.call(this, other);
  });
  try { act(() => { expect(applyForeignContent(editor, value)).toEqual({ fallback: true }); }); }
  finally { eq.mockRestore(); }
  act(() => { productionArrival(base, value); });
  expect(forced).toBe(1);
  expect(dispatches[0].mock.calls.length).toBe(dispatches[1].mock.calls.length);
  expect(callbacks[0].mock.calls.length).toBe(callbacks[1].mock.calls.length);
  expect(parents.map(parent => parent.mock.calls)).toEqual([[], []]);
  expect(editor.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
  expect(editor.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
  expect(undoDepth(editor.state) + redoDepth(editor.state)).toBe(0);
});

it('uses production for an unrecognized selection class even when its nodes are untouched', () => {
  class UnrecognizedSelection extends TextSelection {}
  const view = render(<RichMarkdownEditor value={'First words\n\nTail'} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.view.dispatch(editor.state.tr.setSelection(new UnrecognizedSelection(editor.state.doc.resolve(4)))); });
  const value = 'First words\n\nPHONE Tail';
  const base = baseSnapshot(editor, value);
  act(() => { expect(applyForeignContent(editor, value)).toEqual({ fallback: true }); });
  expect(editor.state.doc.toJSON()).toEqual(base.doc.toJSON());
  expect(editor.state.selection.toJSON()).toEqual(base.selection);
});

it.each([
  ['bare URL', '<h2>https://old.example.org</h2>', true],
  ['linked URL', '<h2><a href="https://old.example.org">https://old.example.org</a></h2>', false],
])('matches production after plugin normalization of a far blockquote with a %s', (_name, heading, fallback) => {
  const before = `First\n\n<blockquote>${heading}<p>3</p></blockquote>\n\nSpacer\n\nWorking`;
  const value = before.replaceAll('old.example.org', 'new.example.org');
  const change = jest.fn();
  const view = render(<RichMarkdownEditor value={before} onChange={change} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(position(editor, 'Working', 3)); });
  let target = editor.state.doc;
  act(() => { target = productionDocument(editor, value); });
  const dispatch = jest.spyOn(editor.view, 'dispatch');
  let result = { fallback: false };
  act(() => { result = applyForeignContent(editor, value); });
  expect(editor.state.doc.eq(target)).toBe(true);
  expect(result.fallback).toBe(fallback);
  // A rejected candidate must never reach the live view before production runs.
  expect(dispatch).toHaveBeenCalledTimes(1);
  if (!result.fallback) expect(editor.state.selection.head).toBe(position(editor, 'Working', 3));
  expect(change).not.toHaveBeenCalled();
});
