import React, { useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';
import FlowEditor from '@/components/groups/FlowEditor';
import SeriesFormFields, { seriesFormValues } from '@/components/series/SeriesFormFields';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';
import { undoDepth } from '@tiptap/pm/history';
jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));
jest.mock('@/components/ui/RichMarkdownEditor', () => {
  const actual = jest.requireActual<typeof import('@/components/ui/RichMarkdownEditor')>('@/components/ui/RichMarkdownEditor');
  return { ...actual, RichMarkdownEditor: (props: React.ComponentProps<typeof actual.RichMarkdownEditor>) => {
    expect(props.ownedBy).toBeUndefined();
    return <actual.RichMarkdownEditor {...props} />;
  } };
});
it.each(['flow', 'series'])('real %s mount survives input between prop commit and passive replacement', kind => {
  let set!: (text: string) => void; let armed = false;
  const calls: unknown[] = [], replacements: string[] = [];
  function Host() {
    const [text, update] = React.useState('Original.'); set = update;
    useLayoutEffect(() => { if (armed && text.includes('PHONE.')) { armed = false; editor.view.dispatch(editor.state.tr.insertText(' Typedword', editor.state.doc.content.size - 1)); } }, [text]);
    if (kind === 'series') return <SeriesFormFields values={{ ...seriesFormValues(), description: text }} colorPickerTitle="Series"
      onChange={patch => { calls.push(patch); if (patch.description !== undefined) update(patch.description); }} />;
    return <FlowEditor template={{ id:'t1', type:'topic', title:'Block', content:text, status:'draft', createdAt:'x', updatedAt:'x' }}
      flowItem={{id:'f1',templateId:'t1',order:1,durationMin:15}}
      onUpdateTemplate={patch => { calls.push(patch); if (patch.content !== undefined) update(patch.content); }}
      onUpdateFlowItem={() => {}} onSetDuration={async () => {}} onSetStatus={async () => {}}
      onRenameBlock={async () => {}} onRenameStep={async () => {}} onClose={() => {}} />;
  }
  const view = render(<Host />); const editor = mountedEditor(view.container);
  editor.on('transaction', ({transaction}) => { if (transaction.getMeta('preventUpdate')) replacements.push(transaction.doc.textContent); });
  armed = true; act(() => set('Original.\n\nPHONE.'));
  expect(calls).toEqual([{ [kind === 'series' ? 'description' : 'content']: 'Original. Typedword' }]);
  expect(markdown(editor)).toBe('Original. Typedword');
  expect(replacements).toEqual([]);
  expect(undoDepth(editor.state)).toBe(1);
  view.unmount();
});
