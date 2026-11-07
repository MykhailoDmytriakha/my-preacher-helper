import type { Editor } from '@tiptap/core';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';

const markdown = 'Lead words\n\n| Person | Words |\n| --- | --- |\n| Paul | Grace |\n\nTail words';

async function openEditor() {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={markdown} onChange={onChange} />);
  await waitFor(() => expect(view.container.querySelector('[contenteditable=true]')).not.toBeNull());
  const root = view.container.querySelector<HTMLElement & { editor: Editor }>('[contenteditable=true]')!;
  const editor = root.editor;
  // JSDOM has no layout. Only scrolling geometry is supplied; document, selection and keymaps are real.
  jest.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 1, top: 0, bottom: 1 });
  jest.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const position = (words: string) => {
    let found = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text === words) found = at;
    });
    if (found < 0) throw new Error('Authored words missing: ' + words);
    return found;
  };
  const text = (words: string) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (node.textContent === words) return node as Text;
    throw new Error('Rendered words missing: ' + words);
  };
  const oldCaret = (words: string) => {
    editor.commands.setTextSelection(position(words) + 1);
    editor.view.focus();
  };
  const nativeCaret = (words: string, to?: number) => {
    const node = text(words), selection = document.getSelection()!;
    selection.setBaseAndExtent(node, 0, node, to ?? 0);
    return node;
  };
  const click = (words: string, detail = 1) => fireEvent.click(text(words).parentElement!, { button: 0, detail });
  const key = (key: 'Tab' | 'Enter') => fireEvent.keyDown(root, { key, code: key, keyCode: key === 'Tab' ? 9 : 13, which: key === 'Tab' ? 9 : 13 });
  return { ...view, root, editor, onChange, oldCaret, nativeCaret, click, key, text };
}

describe('RichMarkdownEditor native click before selectionchange', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('uses the clicked first cell for an immediate Tab instead of adding a row at the old last cell', async () => {
    const fixture = await openEditor();
    const original = fixture.editor.getJSON();
    act(() => {
      fixture.oldCaret('Grace');
      fixture.nativeCaret('Paul');
      // The native trace has this exact gap: DOM has moved, selectionchange has not reached the editor.
      expect(fixture.editor.state.selection.$from.parent.textContent).toBe('Grace');
      fixture.click('Paul');
      fixture.key('Tab');
    });
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(2);
    expect(fixture.editor.state.selection.$from.parent.textContent).toBe('Grace');
    expect(fixture.editor.getJSON()).toEqual(original);
    expect(fixture.onChange).not.toHaveBeenCalled();
  });

  it('uses the newly clicked prose caret for the next Enter and retains the other words', async () => {
    const fixture = await openEditor();
    act(() => {
      fixture.oldCaret('Tail words');
      fixture.nativeCaret('Lead words');
      fixture.click('Lead words');
      fixture.key('Enter');
    });
    expect(fixture.editor.state.doc.firstChild?.textContent).toBe('');
    expect(fixture.editor.state.doc.child(1).textContent).toBe('Lead words');
    expect(fixture.editor.getText()).toContain('Tail words');
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(2);
  });

  it('still adds a row when Tab genuinely starts in the last cell', async () => {
    const fixture = await openEditor();
    act(() => {
      fixture.oldCaret('Grace');
      fixture.nativeCaret('Grace');
      fixture.click('Grace');
      fixture.key('Tab');
    });
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(3);
    expect(fixture.editor.getText()).toContain('Paul');
    expect(fixture.editor.getText()).toContain('Grace');
    expect(fixture.editor.getText()).toContain('Tail words');
    expect(fixture.onChange).toHaveBeenCalled();
  });

  it.each([1, 2])('does not collapse a native selected word on a click with detail %s', async detail => {
    const fixture = await openEditor();
    const original = fixture.editor.getJSON();
    act(() => {
      fixture.oldCaret('Grace');
      fixture.nativeCaret('Paul', 4);
      fixture.click('Paul', detail);
    });
    expect(document.getSelection()?.toString()).toBe('Paul');
    expect(fixture.editor.getJSON()).toEqual(original);
    expect(fixture.onChange).not.toHaveBeenCalled();
  });

  it('does not replace the editor selection during composition', async () => {
    const fixture = await openEditor();
    const original = fixture.editor.getJSON();
    act(() => {
      fixture.oldCaret('Grace');
      jest.spyOn(fixture.editor.view, 'composing', 'get').mockReturnValue(true);
      fixture.nativeCaret('Paul');
      fixture.click('Paul');
    });
    expect(fixture.editor.state.selection.$from.parent.textContent).toBe('Grace');
    expect(fixture.editor.getJSON()).toEqual(original);
    expect(fixture.onChange).not.toHaveBeenCalled();
  });
});
