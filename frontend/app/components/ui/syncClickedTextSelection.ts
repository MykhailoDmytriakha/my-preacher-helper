import { TextSelection } from '@tiptap/pm/state';

import type { EditorView } from '@tiptap/pm/view';

/**
 * A native click moves the browser caret before its deferred selectionchange reaches ProseMirror.
 * Accept that text position before focus or an immediate key command can reuse the old selection.
 */
export function syncClickedTextSelection(view: EditorView, event: MouseEvent): void {
  if (event.button !== 0 || event.detail !== 1 || event.defaultPrevented
    || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
    || !view.editable || view.composing || !view.hasFocus()) return;

  const root = view.root as { getSelection?: () => globalThis.Selection | null };
  const native = root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
  const node = native?.anchorNode;
  if (!native?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE
    || !view.dom.contains(node) || node.parentElement?.closest('[contenteditable="false"]')) return;

  const position = view.posAtDOM(node, native.anchorOffset);
  if (position < 0 || position > view.state.doc.content.size
    || !view.state.doc.resolve(position).parent.inlineContent) return;
  const selection = TextSelection.create(view.state.doc, position);
  if (!selection.eq(view.state.selection)) {
    view.dispatch(view.state.tr.setSelection(selection).setMeta('pointer', true));
  }
}
