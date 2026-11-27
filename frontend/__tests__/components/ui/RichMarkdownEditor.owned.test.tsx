import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useEditorValue } from '@/components/ui/useEditorValue';
import { useEditorOwnedText } from '@/components/ui/useEditorOwnedText';
import { useBufferedText } from '@/components/ui/useBufferedText';

import type { Editor } from '@tiptap/core';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
jest.mock('@/components/ui/useBufferedText', () => {
  const actual = jest.requireActual<typeof import('@/components/ui/useBufferedText')>('@/components/ui/useBufferedText');
  return { ...actual, useBufferedText: jest.fn(actual.useBufferedText) };
});
jest.mock('@tiptap/react', () => {
  const actual = jest.requireActual<typeof import('@tiptap/react')>('@tiptap/react');
  return { ...actual, useEditor: (options: Parameters<typeof actual.useEditor>[0]) => {
    // Force the rendered option to be stale at the actual construction boundary (106 section 1).
    const editor = actual.useEditor(mockStale ? { ...options, content: 'Stale render' } : options);
    if (editor) mockEditor = editor;
    return mockHideEditor ? null : editor;
  } };
});
let mockEditor: Editor;
let mockStale = false;
let mockHideEditor = false;
const markdown = () => (mockEditor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
afterEach(() => { mockStale = false; mockHideEditor = false; jest.useRealTimers(); });

it.each([false, true])('keeps the arrival at forced stale creation before asynchronous create, strict=%s', strict => {
  jest.useFakeTimers();
  mockStale = true;
  const { result } = renderHook(() => useEditorOwnedText('**Arrival**'));
  const child = <RichMarkdownEditor ownedBy={result.current.ownedBy} />;
  render(strict ? <React.StrictMode>{child}</React.StrictMode> : child);
  expect(markdown()).toBe('**Arrival**');
  expect(useBufferedText).not.toHaveBeenCalled();
  act(() => result.current.append('Voice'));
  expect(markdown()).toBe('**Arrival**\n\nVoice');
  act(() => mockEditor.view.dispatch(mockEditor.state.tr.insertText(' Typed', mockEditor.state.doc.content.size - 1)));
  expect(result.current.live()).toBe('**Arrival**\n\nVoice Typed');
});

it('makes append its own undoable step, keeps selection and scroll, and emits nothing', () => {
  const { result } = renderHook(() => useEditorOwnedText('Original\n\n<!-- Hidden -->'));
  render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  mockEditor.commands.setTextSelection(3);
  const selection = mockEditor.state.selection.toJSON();
  act(() => mockEditor.view.dispatch(mockEditor.state.tr.insertText('Typed', 3)));
  const typed = markdown();
  const caret = mockEditor.state.selection.toJSON();
  const updates = jest.fn(); mockEditor.on('update', updates);
  const transactions: { changed: boolean; scrolled: boolean }[] = [];
  mockEditor.on('transaction', ({ transaction }) => transactions.push({ changed: transaction.docChanged, scrolled: transaction.scrolledIntoView }));
  act(() => result.current.append('**Voice**\n\nAnother block'));
  expect(updates).not.toHaveBeenCalled();
  expect(transactions).toEqual([{ changed: true, scrolled: false }, { changed: false, scrolled: false }]);
  expect(mockEditor.state.selection.toJSON()).toEqual(caret);
  expect(caret).not.toEqual(selection);
  expect(markdown()).toBe(typed + '\n\n**Voice**\n\nAnother block');
  act(() => { mockEditor.commands.undo(); });
  expect(markdown()).toBe(typed);
  act(() => { mockEditor.commands.redo(); });
  expect(markdown()).toContain('Voice');
  act(() => result.current.follow('Arrival'));
  expect(updates).toHaveBeenCalledTimes(2);
  expect(undoDepth(mockEditor.state)).toBe(0);
  act(() => result.current.replace('Recovered'));
  expect(updates).toHaveBeenCalledTimes(2);
  act(() => { mockEditor.commands.undo(); });
  expect(result.current.live()).toBe('Arrival');
});

it.each(['dictation append', 'recovered replacement'] as const)('undoes typing separately on both sides of an owned %s', action => {
  const opening = 'First note sentence.';
  const { result } = renderHook(() => useEditorOwnedText(opening));
  render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  const type = (text: string) => act(() => {
    mockEditor.view.dispatch(mockEditor.state.tr.insertText(text, mockEditor.state.doc.content.size - 1));
  });
  type(' Typed before.');
  const beforeAction = opening + ' Typed before.';
  expect(markdown()).toBe(beforeAction);
  act(() => {
    if (action === 'dictation append') result.current.append('Dictated block.');
    else result.current.replace('The explicitly recovered version.');
  });
  const own = action === 'dictation append' ? beforeAction + '\n\nDictated block.' : 'The explicitly recovered version.';
  expect(markdown()).toBe(own);
  type(' Typed after.');
  expect(markdown()).toBe(own + ' Typed after.');
  const undo = () => act(() => { expect(mockEditor.commands.undo()).toBe(true); });
  const redo = () => act(() => { expect(mockEditor.commands.redo()).toBe(true); });
  undo(); expect(markdown()).toBe(own);
  undo(); expect(markdown()).toBe(beforeAction);
  undo(); expect(markdown()).toBe(opening);
  redo(); expect(markdown()).toBe(beforeAction);
  redo(); expect(markdown()).toBe(own);
  redo(); expect(markdown()).toBe(own + ' Typed after.');
});

it('preserves raw unsupported source on append until a real editor emission', () => {
  const unsupported = 'Original\n\n<details open><summary>Extra</summary><p>Details</p></details>';
  const { result } = renderHook(() => useEditorOwnedText(unsupported));
  render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  act(() => result.current.append('Voice'));
  expect(result.current.live()).toBe(unsupported + '\n\nVoice');
  expect(markdown()).not.toContain('<details');
});

it('keeps the new registration after a late destroy of the previous editor', () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('Original'));
  const view = render(<RichMarkdownEditor key="old" ownedBy={result.current.ownedBy} />);
  const old = mockEditor;
  view.rerender(<RichMarkdownEditor key="new" ownedBy={result.current.ownedBy} />);
  expect(mockEditor).not.toBe(old);
  act(() => jest.advanceTimersByTime(1));
  expect(old.isDestroyed).toBe(true);
  act(() => { result.current.follow('Arrival'); result.current.append('Voice'); });
  expect(markdown()).toBe('Arrival\n\nVoice');
});

it('retains the legacy foreign boundary when values change before an editor-bearing render', () => {
  mockHideEditor = true;
  let supply!: () => void;
  function Host() {
    const value = useEditorValue('Opening');
    supply = () => { value.observe('Remote'); value.act('Own'); };
    return <RichMarkdownEditor value={value.value} onChange={value.observe}
      valueIsUserAction={value.isUserAction} valueBeforeUserAction={value.foreignValueBeforeAction} />;
  }
  const view = render(<Host />);
  expect(markdown()).toBe('Opening');
  act(() => supply());
  mockHideEditor = false;
  view.rerender(<Host />);
  expect(markdown()).toBe('Own');
  act(() => { expect(mockEditor.commands.undo()).toBe(true); });
  expect(markdown()).toBe('Remote');
});
