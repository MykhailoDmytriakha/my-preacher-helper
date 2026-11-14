import { history } from '@tiptap/pm/history';

import type { Editor } from '@tiptap/core';

// The public factory exposes its PluginKey; never inspect the history state or branches.
const historyKey = history().spec.key!;

/** Retire both history branches after every foreign replacement without replacing the editor. */
export function retireHistory(editor: Editor): void {
    const state = editor.state;
    const plugin = historyKey.get(state);
    if (!plugin) return;
    // Only history loses its state. Other plugin instances, order, state fields, doc and selection survive.
    // Reconfigure off-view twice, then update once: installed ProseMirror restarts plugin views once.
    const withoutHistory = state.reconfigure({ plugins: state.plugins.filter(candidate => candidate !== plugin) });
    const retired = withoutHistory.reconfigure({ plugins: state.plugins });
    // Installed dropcursor.destroy leaves its overlay alive. Its public DOM handler clears it first.
    editor.view.dom.dispatchEvent(new Event('dragleave'));
    editor.view.updateState(retired);
}
