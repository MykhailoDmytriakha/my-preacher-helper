import { act, render, renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/core';

// Select the installed observer's Android-Chrome branch before loading ProseMirror.
const originalAgent = navigator.userAgent;
Object.defineProperty(navigator, 'userAgent', { configurable: true,
  value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' });
const { RichMarkdownEditor } = require('@/components/ui/RichMarkdownEditor');
const { useEditorOwnedText } = require('@/components/ui/useEditorOwnedText') as typeof import('@/components/ui/useEditorOwnedText');
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
afterAll(() => { Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent }); });

it('characterizes OPEN Android native deletion while its public beforeinput defers observation beyond the transcript handoff', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('Original'));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  try {
    mockEditor.view.setProps({ handleScrollToSelection: () => true });
    let transcript!: void | Promise<void>;
    await act(async () => {
      mockEditor.view.dom.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
      mockEditor.view.dom.querySelector('p')!.firstChild!.nodeValue = 'Origina';
      mockEditor.view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      transcript = result.current.append('Voice');
      await transcript;
    });
    // A microtask is not an admission receipt: the native deletion is still pending.
    // Deciding browser test: Android Chrome backspace at an uneditable-node boundary
    // concurrent with transcript completion; require the deletion and Voice after reload.
    expect(mockEditor.view.composing).toBe(false);
    expect(result.current.live()).toBe('Original\n\nVoice');
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    // This simple deletion eventually reaches the document; it was absent from
    // the append's published snapshot. Structural changes need the browser oracle.
    expect(mockEditor.state.doc.textContent).toBe('OriginaVoice');
  } finally { mounted.unmount(); jest.useRealTimers(); }
});

it('characterizes OPEN paragraph splitting during the same deferred Android observation interval', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('FirstSecond'));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  try {
    mockEditor.view.setProps({ handleScrollToSelection: () => true });
    act(() => mockEditor.commands.setTextSelection(6));
    await act(async () => {
      // Android's observer delay can outlast this event and another native change.
      mockEditor.view.dom.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
      const transcript = Promise.resolve().then(() => result.current.append('Voice'));
      const p = mockEditor.view.dom.querySelector('p')!;
      const second = (p.firstChild as Text).splitText(5);
      const next = document.createElement('p'); next.append(second); p.after(next);
      const selection = window.getSelection()!;
      selection.collapse(second, 0);
      mockEditor.view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
      await transcript;
    });
    expect(mockEditor.view.composing).toBe(false);
    expect(result.current.live()).toBe('FirstSecond\n\nVoice');
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    // This controlled split is admitted later. That success is narrower than an
    // admission guarantee at the transcript receipt, which precedes observation.
    // Browser oracle: Android backspace then native paragraph split as dictation
    // completes inside the observer delay; retain First, Second and Voice after reload.
    expect(result.current.live()).toBe('First\n\nSecond\n\nVoice');
  } finally { mounted.unmount(); jest.useRealTimers(); }
});

it.each([
  { label: 'a deletion that delayed its idle composition ending', renew: false, dictationArrivesLater: false },
  { label: 'the real end of a renewed composition', renew: true, dictationArrivesLater: false },
  { label: 'a stalled deletion that happened before dictation arrived', renew: false, dictationArrivesLater: true },
])('appends dictated words after Android admits $label', async ({ renew, dictationArrivesLater }) => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useEditorOwnedText('Original'));
  const mounted = render(<RichMarkdownEditor ownedBy={result.current.ownedBy} />);
  try {
    const { view } = mockEditor;
    view.setProps({ handleScrollToSelection: () => true });
    const nativeWords = view.dom.querySelector('p')!.firstChild!;
    await act(async () => {
      view.dom.focus();
      window.getSelection()!.collapse(nativeWords, nativeWords.textContent!.length);
      view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      view.dom.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: ' native' }));
      nativeWords.nodeValue = 'Original native';
      window.getSelection()!.collapse(nativeWords, nativeWords.textContent!.length);
      view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
    });
    expect(view.composing).toBe(true);
    let appended = false;
    const appendDictatedWords = () => {
      void Promise.resolve(result.current.append('Voice')).then(() => { appended = true; }, () => undefined);
    };
    if (!dictationArrivesLater) act(appendDictatedWords);
    await act(async () => { await jest.advanceTimersByTimeAsync(4990); });
    expect(appended).toBe(false);

    await act(async () => {
      view.dom.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
      nativeWords.nodeValue = 'Original nativ';
      window.getSelection()!.collapse(nativeWords, nativeWords.textContent!.length);
      view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      await jest.advanceTimersByTimeAsync(11);
    });
    expect(view.composing).toBe(true);
    expect(appended).toBe(false);

    const finalWords = renew ? 'Original native renewed' : 'Original nativ';
    if (renew) {
      await act(async () => {
        view.dom.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: ' native renewed' }));
        nativeWords.nodeValue = finalWords;
        window.getSelection()!.collapse(nativeWords, nativeWords.textContent!.length);
        view.dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
      });
    }
    await act(async () => { await jest.advanceTimersByTimeAsync(30); });
    expect(view.state.doc.textContent).toContain(finalWords);
    if (dictationArrivesLater) {
      expect(view.composing).toBe(true);
      await act(async () => { appendDictatedWords(); });
    }
    if (renew) {
      expect(view.composing).toBe(true);
      expect(appended).toBe(false);
      await act(async () => {
        view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ' native renewed' }));
        await jest.advanceTimersByTimeAsync(0);
      });
    }
    expect(view.composing).toBe(false);
    expect(appended).toBe(true);
    expect(result.current.live()).toBe(finalWords + '\n\nVoice');
  } finally { mounted.unmount(); jest.useRealTimers(); }
});
