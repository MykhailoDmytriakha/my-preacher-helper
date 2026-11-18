import { act, cleanup, render, renderHook } from '@testing-library/react';

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

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  cleanup();
  jest.advanceTimersByTime(1);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mountEditor() {
  const { result } = renderHook(() => useEditorOwnedText('Original'));
  render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  mockEditor.view.setProps({ handleScrollToSelection: () => true });
  return result;
}

it.each(['transaction', 'update'] as const)(
  'rechecks a waiting append after an editor %s without a DOM compositionend or timer',
  async event => {
    const result = mountEditor();
    // Isolate each public wake-up source; the page tests exercise the real Android timer.
    const composing = jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(true);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = Promise.resolve(result.current.append('Voice')).catch(error => error);
      mockEditor.view.dispatch(mockEditor.state.tr.insertText(' native', mockEditor.state.doc.content.size - 1));
    });
    expect(result.current.live()).toBe('Original native');
    composing.mockReturnValue(false);
    await act(async () => {
      mockEditor.emit(event, { editor: mockEditor, transaction: mockEditor.state.tr, appendedTransactions: [] });
      await pending;
    });
    expect(result.current.live()).toBe('Original native\n\nVoice');
  },
);

it('keeps rechecking without admitting either queued transcript while the editor still composes', async () => {
  const result = mountEditor();
  const composing = jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(true);
  let first!: Promise<unknown>, second!: Promise<unknown>;
  await act(async () => {
    first = Promise.resolve(result.current.append('First voice')).catch(error => error);
    second = Promise.resolve(result.current.append('Second voice')).catch(error => error);
    await jest.advanceTimersByTimeAsync(11000);
  });
  expect(result.current.live()).toBe('Original');
  expect(mockEditor.state.doc.textContent).toBe('Original');
  composing.mockReturnValue(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.all([first, second]);
  });
  expect(result.current.live()).toBe('Original\n\nFirst voice\n\nSecond voice');
  await act(async () => { await jest.advanceTimersByTimeAsync(15000); });
  expect(result.current.live()).toBe('Original\n\nFirst voice\n\nSecond voice');
});

it('rechecks immediately if the editor finishes between a refused append and waiter registration', async () => {
  const result = mountEditor();
  jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValueOnce(true).mockReturnValue(false);
  await act(async () => { await result.current.append('Voice'); });
  expect(result.current.live()).toBe('Original\n\nVoice');
});

it('applies a fresh transcript synchronously when the editor is already idle after compositionstart', async () => {
  const result = mountEditor();
  act(() => { mockEditor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  jest.spyOn(mockEditor.view, 'composing', 'get').mockReturnValue(false);
  act(() => {
    expect(result.current.append('Voice')).toBeUndefined();
    expect(result.current.live()).toBe('Original\n\nVoice');
  });
});
