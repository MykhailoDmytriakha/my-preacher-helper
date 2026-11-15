import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { redoDepth, undoDepth } from '@tiptap/pm/history';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useEditorValue, useEditorValues } from '@/components/ui/useEditorValue';
import { markdown, mountedEditor, typeAtEnd, undo } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it.each([false, true])('C08 applies a batched foreign value before one own step, per-cell=%s', multi => {
  let observe = (_value: string) => {};
  let actOwn = (_value: (prior: string) => string) => {};
  function Host() {
    const scalar = useEditorValue('Original.');
    const cells = useEditorValues();
    observe = value => multi ? cells.observe({ p: value }) : scalar.observe(value);
    actOwn = value => multi ? cells.act(prior => ({ ...prior, p: value(prior.p ?? 'Original.') })) : scalar.act(value);
    const value = multi ? cells.value.p ?? 'Original.' : scalar.value;
    const own = multi ? cells.userActionValues.p === value : scalar.isUserAction;
    return <RichMarkdownEditor value={value} valueIsUserAction={own} valueBeforeUserAction={multi ? cells.foreignValuesBeforeAction.p : scalar.foreignValueBeforeAction} onChange={observe} />;
  }
  const view = render(<React.StrictMode><Host /></React.StrictMode>);
  const editor = mountedEditor(view.container);
  act(() => { observe('Original.\n\nPHONE.'); actOwn(prior => prior + '\n\nDictation.'); });
  expect(markdown(editor)).toBe('Original.\n\nPHONE.\n\nDictation.');
  expect(undoDepth(editor.state)).toBe(1);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe('Original.\n\nPHONE.');
  expect(undoDepth(editor.state)).toBe(0);
  expect(undo(editor)).toBe(false);
  expect(redoDepth(editor.state)).toBe(1);
  act(() => { expect(editor.commands.redo()).toBe(true); });
  expect(markdown(editor)).toBe('Original.\n\nPHONE.\n\nDictation.');
});

it.each([false, true])('preserves the incoming Undo boundary while composition delays drawing, separate renders=%s', async separate => {
  let change: ReturnType<typeof useEditorValue<string>>;
  function Host() {
    change = useEditorValue('Original.');
    return <RichMarkdownEditor value={change.value} valueIsUserAction={change.isUserAction}
      valueBeforeUserAction={change.foreignValueBeforeAction} onChange={change.observe} />;
  }
  const view = render(<Host />);
  const editor = mountedEditor(view.container);
  fireEvent.compositionStart(editor.view.dom);
  const observe = () => change.observe('Original.\n\nPHONE.');
  const append = () => change.append(previous => previous + '\n\nDictation.');
  if (separate) {
    act(observe);
    act(append);
  } else {
    act(() => { observe(); append(); });
  }
  expect(markdown(editor)).toBe('Original.');
  await act(async () => { fireEvent.compositionEnd(editor.view.dom, { data: '' }); });
  expect(markdown(editor)).toBe('Original.\n\nPHONE.\n\nDictation.');
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe('Original.\n\nPHONE.');
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(true); });
  expect(markdown(editor)).toBe('Original.\n\nPHONE.\n\nDictation.');
});

it.each([false, true])('keeps incoming words when undoing dictation after confirmed composition, overlap=%s', async overlap => {
  let change: ReturnType<typeof useEditorValue<string>>;
  function Host() {
    change = useEditorValue('Original.');
    return <RichMarkdownEditor value={change.value} valueIsUserAction={change.isUserAction} observedAppend={change.appended}
      valueBeforeUserAction={change.foreignValueBeforeAction} onChange={change.observe} />;
  }
  const view = render(<Host />);
  const editor = mountedEditor(view.container);
  const incoming = overlap ? 'PHONE.' : 'Original.\n\nPHONE.';
  const withDictation = incoming + '\n\nDictation.';
  fireEvent.compositionStart(editor.view.dom);
  typeAtEnd(editor, ' 日本語');
  act(() => change.observe(incoming));
  act(() => change.append(previous => previous + '\n\nDictation.'));
  await act(async () => { fireEvent.compositionEnd(editor.view.dom, { data: '日本語' }); });
  if (overlap) {
    fireEvent.click(screen.getByRole('button', { name: 'richEditor.compositionChoice.keepUpdated' }));
  } else {
    expect(markdown(editor)).toBe('Original. 日本語\n\nPHONE.\n\nDictation.');
    expect(undo(editor)).toBe(true);
  }
  expect(markdown(editor)).toBe(withDictation);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(incoming);
  expect(undo(editor)).toBe(false);
});

it('preserves the incoming Undo boundary while a changed editing paragraph delays drawing', () => {
  let change: ReturnType<typeof useEditorValue<string>>;
  function Host() {
    change = useEditorValue('Original.\n\nOther paragraph.');
    return <RichMarkdownEditor value={change.value} valueIsUserAction={change.isUserAction}
      valueBeforeUserAction={change.foreignValueBeforeAction} onChange={change.observe} />;
  }
  const view = render(<Host />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  act(() => change.observe('PHONE.\n\nOther paragraph.'));
  expect(markdown(editor)).toBe('Original.\n\nOther paragraph.');
  act(() => change.append(previous => previous + '\n\nDictation.'));
  expect(markdown(editor)).toBe('PHONE.\n\nOther paragraph.\n\nDictation.');
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe('PHONE.\n\nOther paragraph.');
  expect(undo(editor)).toBe(false);
});

it.each([false, true])('D05 batches unrelated foreign and own cells in either order, own first=%s', ownFirst => {
  let change: ReturnType<typeof useEditorValues>;
  function Host() {
    change = useEditorValues();
    return <>{['p', 'q'].map(key => <section key={key} data-testid={key}>
      <RichMarkdownEditor value={change.value[key] ?? key} valueBeforeUserAction={change.foreignValuesBeforeAction[key]} valueIsUserAction={change.userActionValues[key] !== undefined && change.userActionValues[key] === change.value[key]} onChange={value => change.act(previous => ({ ...previous, [key]: value }))} />
    </section>)}</>;
  }
  render(<Host />);
  const p = mountedEditor(screen.getByTestId('p')), q = mountedEditor(screen.getByTestId('q'));
  act(() => {
    const own = () => change.act(previous => ({ ...previous, q: 'q requested' }));
    const foreign = () => change.observe(previous => ({ ...previous, p: 'p PHONE' }));
    if (ownFirst) { own(); foreign(); } else { foreign(); own(); }
  });
  expect(undo(p)).toBe(false); expect(markdown(p)).toBe('p PHONE');
  expect(undo(q)).toBe(true); expect(markdown(q)).toBe('q');
});

it('D06 clears a scalar own marker on a later changed observation and ignores late origin-only renders', () => {
  let change: ReturnType<typeof useEditorValue<string>>;
  let setLateOrigin: React.Dispatch<React.SetStateAction<boolean | undefined>>;
  function Host() {
    change = useEditorValue('Opening');
    const [lateOrigin, setLate] = React.useState<boolean | undefined>();
    setLateOrigin = setLate;
    return <RichMarkdownEditor value={change.value} valueBeforeUserAction={change.foreignValueBeforeAction} valueIsUserAction={lateOrigin ?? change.isUserAction} onChange={change.observe} />;
  }
  const view = render(<Host />), editor = mountedEditor(view.container);
  act(() => change.act('Requested'));
  expect(undo(editor)).toBe(true);
  act(() => change.observe('Opening PHONE'));
  act(() => setLateOrigin(true));
  expect(markdown(editor)).toBe('Opening PHONE');
  expect(undo(editor)).toBe(false);
  act(() => setLateOrigin(false));
  act(() => change.act('Own before foreign'));
  act(() => change.observe('Final PHONE'));
  expect(markdown(editor)).toBe('Final PHONE');
  expect(undo(editor)).toBe(false);
});

it.each([false, true])('C08 retains a foreign boundary when the final own value equals the rendered value, per-cell=%s', multi => {
  let supply = () => {};
  function Host() {
    const scalar = useEditorValue('Original.');
    const cells = useEditorValues();
    supply = () => {
      if (multi) { cells.observe({ p: 'PHONE.' }); cells.act({ p: 'Original.' }); }
      else { scalar.observe('PHONE.'); scalar.act('Original.'); }
    };
    const value = multi ? cells.value.p ?? 'Original.' : scalar.value;
    return <RichMarkdownEditor value={value} valueIsUserAction={multi ? cells.userActionValues.p === value : scalar.isUserAction}
      valueBeforeUserAction={multi ? cells.foreignValuesBeforeAction.p : scalar.foreignValueBeforeAction}
      onChange={next => multi ? cells.observe({ p: next }) : scalar.observe(next)} />;
  }
  const view = render(<Host />), editor = mountedEditor(view.container);
  act(supply);
  expect(markdown(editor)).toBe('Original.');
  expect(undoDepth(editor.state)).toBe(1);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe('PHONE.');
  expect(undo(editor)).toBe(false);
});

it('initial values remain inert even when a parent carries an earlier batched baseline', () => {
  const view = render(<RichMarkdownEditor value="Own." valueIsUserAction valueBeforeUserAction={{ value: 'PHONE.' }} onChange={() => {}} />);
  const editor = mountedEditor(view.container);
  expect(markdown(editor)).toBe('Own.');
  expect(undo(editor)).toBe(false);
});
