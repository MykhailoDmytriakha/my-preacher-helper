import { fireEvent, render, screen } from '@testing-library/react';

import ScriptureRefPicker from '@/(pages)/(private)/studies/ScriptureRefPicker';

jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en' }) }));

const span = { id: 'span', bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16, endChapter: 4, toVerse: 2 };

describe('ScriptureRefPicker exact verse endpoints', () => {
  it('saves a manually changed ending chapter instead of returning the untouched initial reference', () => {
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={span} onConfirm={onConfirm} onCancel={jest.fn()} mode="edit" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'studiesWorkspace.toChapter' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    const { id: _id, ...expected } = span;
    expect(onConfirm).toHaveBeenCalledWith({ ...expected, endChapter: 5 });
  });

  it('edits a cross-chapter reference without changing either endpoint', () => {
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={span} onConfirm={onConfirm} onCancel={jest.fn()} mode="edit" />);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    const { id: _id, ...expected } = span;
    expect(onConfirm).toHaveBeenCalledWith(expected);
  });

  it('requires an ending verse after choosing another ending chapter', () => {
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={{ ...span, endChapter: undefined, toVerse: undefined }} onConfirm={onConfirm} onCancel={jest.fn()} mode="edit" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'studiesWorkspace.toChapter' }), { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[4], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    const { id: _id, ...expected } = span;
    expect(onConfirm).toHaveBeenCalledWith(expected);
  });

  it('preserves a legacy leftover chapter range when nothing was changed', () => {
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={{ id: 'old', bible: 'kjv', book: 'Luke', chapter: 5, fromVerse: 17, toChapter: 6 }} onConfirm={onConfirm} onCancel={jest.fn()} mode="edit" />);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'kjv', book: 'Luke', chapter: 5, fromVerse: 17, toChapter: 6 });
  });
});
