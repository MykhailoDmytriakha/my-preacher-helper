import { act, render } from '@testing-library/react';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import React from 'react';

import { applyForeignContent } from '@/components/ui/foreignContent';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { productionArrival } from '@test-utils/foreignContent';
import { fallbackCases, nextAction, nextActions, selectFallbackCase } from '@test-utils/foreignSelection';
import { mountedEditor } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it.each(fallbackCases.flatMap(sample => nextActions.map(action => ({ ...sample, action }))))(
  'matches production after $name and inherited $action', sample => {
    const changes = [jest.fn(), jest.fn()];
    const views = changes.map(change => render(<RichMarkdownEditor value={sample.before} onChange={change} />));
    const [current, base] = views.map(view => mountedEditor(view.container));
    act(() => {
      for (const editor of [current, base]) {
        // Carry real own history into the boundary, including a Redo branch.
        editor.commands.insertContent('OWN');
        editor.commands.undo();
        selectFallbackCase(editor, sample);
        editor.view.focus();
      }
    });
    changes.forEach(change => change.mockClear());
    const dispatch = jest.spyOn(current.view, 'dispatch');
    act(() => {
      current.view.focus();
      expect(applyForeignContent(current, sample.after)).toEqual({ fallback: true });
    });
    const currentFocus = { focused: current.view.hasFocus(), active: document.activeElement === current.view.dom };
    act(() => { base.view.focus(); productionArrival(base, sample.after); });
    const baseFocus = { focused: base.view.hasFocus(), active: document.activeElement === base.view.dom };
    // The rejected node path never dispatches: only BASE's whole replacement runs.
    expect(dispatch.mock.calls.filter(([tr]) => tr.docChanged)).toHaveLength(1);
    expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
    expect(current.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
    expect(changes.map(change => change.mock.calls)).toEqual([[], []]);
    expect([undoDepth(current.state), redoDepth(current.state)]).toEqual([undoDepth(base.state), redoDepth(base.state)]);
    expect(currentFocus).toEqual(baseFocus);
    expect(currentFocus).toEqual({ focused: true, active: true });
    act(() => {
      expect(nextAction(current, sample.action)).toBe(nextAction(base, sample.action));
    });
    expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
    expect(current.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
    act(() => { expect(current.commands.undo()).toBe(base.commands.undo()); });
    expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
    act(() => { expect(current.commands.redo()).toBe(base.commands.redo()); });
    expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
    views.forEach(view => view.unmount());
  },
);
