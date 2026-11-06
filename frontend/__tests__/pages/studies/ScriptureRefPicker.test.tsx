import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ScriptureRefPicker from '@/(pages)/(private)/studies/ScriptureRefPicker';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let mockLocale = 'en';
jest.mock('@/hooks/useAppLocale', () => ({
  useAppLocale: () => ({ locale: mockLocale }),
}));

/*
 * The picker preserves a reference in its original Bible when the person changes nothing.
 * Contiguous chapter seams have exact endpoints; separated mapped passages still do not fit one
 * editable selection. Field normalization must not count as a choice made by the person.
 */
describe('ScriptureRefPicker, saving a reference nobody changed', () => {
  afterEach(() => { mockLocale = 'en'; });

  const open = (initialRef: React.ComponentProps<typeof ScriptureRefPicker>['initialRef']) => {
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={initialRef} mode="edit" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    return onConfirm;
  };

  it('names each field by its label for a screen reader', () => {
    render(<ScriptureRefPicker mode="add" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByLabelText('studiesWorkspace.book').tagName).toBe('SELECT');
    expect(screen.getByLabelText('studiesWorkspace.chapter').tagName).toBe('SELECT');
  });

  it('gives back the reference as it was written, in its own Bible, when shown in another one', () => {
    const onConfirm = open({ id: 'r1', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
  });

  it('gives back an old reference with a chapter range left beside its verses with its verses', () => {
    mockLocale = 'ru';
    const onConfirm = open({ id: 'r3', bible: 'rst', book: 'Psalms', chapter: 9, toChapter: 10, fromVerse: 20, toVerse: 25 });
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 9, toChapter: 10, fromVerse: 20, toVerse: 25 });
  });

  it('gives it back as written though the form straightened its fields when it opened', () => {
    // Opened as the range 50-10, the form raises its end to 50 by itself; that is not the person's change.
    mockLocale = 'ru';
    const onConfirm = open({ id: 'r4', bible: 'rst', book: 'Psalms', chapter: 50, toChapter: 10, fromVerse: 12 });
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 50, toChapter: 10, fromVerse: 12 });
  });

  it('gives it back as written when the person pressed the scope already chosen', () => {
    const onConfirm = jest.fn();
    // Synodal Ps 9:20-25 opens in the English reader as the verses Ps 9:19-10:4.
    render(<ScriptureRefPicker initialRef={{ id: 'r6', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 }} mode="edit" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.scopeVerses' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
  });

  it('gives back what the person chose once they changed something', () => {
    mockLocale = 'ru';
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={{ id: 'r5', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }} mode="edit" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.scopeChapter' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 50 });
  });

  it('gives back an untouched reference of the person’s own Bible as it is', () => {
    mockLocale = 'ru';
    const onConfirm = open({ id: 'r2', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 });
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 });
  });
});

describe('ScriptureRefPicker reads incoming cross-chapter comments', () => {
  afterEach(() => { mockLocale = 'en'; });
  const reference = { id: 'incoming-ending', bible: 'rst' as const, book: 'Ephesians', chapter: 4, fromVerse: 31, toVerseChapter: 5, toVerse: 2 };

  it('shows both endpoints before any edit', () => {
    mockLocale = 'ru';
    render(<ScriptureRefPicker initialRef={reference} mode="edit" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByLabelText('studiesWorkspace.toChapter')).toHaveValue('5');
    expect(screen.getByLabelText('studiesWorkspace.to')).toHaveValue('2');
  });

  it('keeps the far endpoint when the person changes only the first verse', () => {
    mockLocale = 'ru';
    const onConfirm = jest.fn();
    render(<ScriptureRefPicker initialRef={reference} mode="edit" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('studiesWorkspace.from'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onConfirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Ephesians', chapter: 4, fromVerse: 30, endChapter: 5, toVerse: 2 });
  });
});
