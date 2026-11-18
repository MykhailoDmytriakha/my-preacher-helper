import { act, render, renderHook } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';

import { canonicalForeignTarget } from '@/components/ui/foreignContent';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useEditorOwnedText } from '@/components/ui/useEditorOwnedText';

import type { Editor } from '@tiptap/core';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
jest.mock('@tiptap/react', () => {
  const actual = jest.requireActual<typeof import('@tiptap/react')>('@tiptap/react');
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args);
    if (editor) mockEditor = editor;
    return editor;
  } };
});
let mockEditor: Editor;

it.each([
  ['', 'Voice'],
  ['', '---'],
  ['#', 'Voice'],
  ['```\n\n```', 'Voice'],
  ['- First\n- Second', '- Third\n- Fourth'],
  ['1. First\n2. Second', '1. Third\n2. Fourth'],
  ['Original\n\n<!-- Hidden -->', 'Voice'],
])('keeps %j plus %j as the exact published parse with one undo step and a valid caret', (source, block) => {
  const { result } = renderHook(() => useEditorOwnedText(source));
  render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  act(() => mockEditor.commands.setTextSelection(source.includes('First') ? 5 : 1));
  const before = mockEditor.state.doc;
  const sourceBefore = result.current.live();
  const depth = undoDepth(mockEditor.state);
  const selection = mockEditor.state.selection.toJSON();
  act(() => result.current.append(block));
  expect(mockEditor.state.doc.eq(canonicalForeignTarget(mockEditor, result.current.live()))).toBe(true);
  expect(result.current.live()).toBe(sourceBefore ? `${sourceBefore}\n\n${block}` : block);
  if (block !== '---') expect(mockEditor.state.selection.toJSON()).toEqual(selection);
  expect(mockEditor.state.selection.$head.parent.inlineContent).toBe(true);
  expect(undoDepth(mockEditor.state)).toBe(depth + 1);
  act(() => { mockEditor.commands.undo(); });
  expect(mockEditor.state.doc.eq(before)).toBe(true);
  act(() => { mockEditor.commands.redo(); });
  expect(mockEditor.state.doc.eq(canonicalForeignTarget(mockEditor, result.current.live()))).toBe(true);
});

it('waits through native composition, then appends queued blocks to the admitted words in order', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText(''));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  const composing = jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(true);
  try {
    let first!: void | Promise<void>, second!: void | Promise<void>;
    await act(async () => {
      first = result.current.append('First voice');
      second = result.current.append('Second voice');
      mockEditor.view.dom.querySelector('p')!.prepend(document.createTextNode('Nativeword'));
      mockEditor.view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'Nativeword' }));
    });
    expect(result.current.live()).not.toContain('voice');
    expect(mockEditor.state.doc.textContent).toBe('Nativeword');
    await act(async () => { await jest.advanceTimersByTimeAsync(60); });
    expect(result.current.live()).toBe('Nativeword');
    composing.mockReturnValue(false);
    await act(async () => { await jest.advanceTimersByTimeAsync(20); await Promise.all([first, second]); });
    expect(result.current.live()).toBe('Nativeword\n\nFirst voice\n\nSecond voice');
    expect(mockEditor.state.doc.eq(canonicalForeignTarget(mockEditor, result.current.live()))).toBe(true);
    act(() => { mockEditor.commands.undo(); });
    expect(result.current.live()).toBe('Nativeword\n\nFirst voice');
    act(() => { mockEditor.commands.undo(); });
    expect(result.current.live()).toBe('Nativeword');
  } finally { composing.mockRestore(); mounted.unmount(); jest.useRealTimers(); }
});

it('refuses a deferred append if its editor closes before native composition ends', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('Original'));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  const composing = jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(true);
  try {
    let outcome!: Promise<unknown>;
    await act(async () => {
      outcome = Promise.resolve(result.current.append('Voice')).catch(error => error);
    });
    mounted.unmount();
    await act(async () => { await jest.advanceTimersByTimeAsync(20); });
    expect(await outcome).toEqual(new Error('The note editor closed before text could be appended'));
    expect(result.current.live()).toBe('Original');
  } finally { composing.mockRestore(); jest.useRealTimers(); }
});

it('keeps transcript order when another append arrives just after composition ends', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('Nativeword'));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  const composing = jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(true);
  try {
    let first!: void | Promise<void>, second!: void | Promise<void>;
    await act(async () => { first = result.current.append('First voice'); });
    composing.mockReturnValue(false);
    await act(async () => {
      second = result.current.append('Second voice');
      await jest.advanceTimersByTimeAsync(20);
      await Promise.all([first, second]);
    });
    expect(result.current.live()).toBe('Nativeword\n\nFirst voice\n\nSecond voice');
  } finally { composing.mockRestore(); mounted.unmount(); jest.useRealTimers(); }
});
