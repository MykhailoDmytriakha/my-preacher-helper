import { fireEvent, render, screen } from '@testing-library/react';

import ScriptureRefPicker from '@/(pages)/(private)/studies/ScriptureRefPicker';

import type { ScriptureReference } from '@/models/models';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en' }) }));

const passage: ScriptureReference = {
  id: 'eph', bible: 'kjv', book: 'Ephesians', chapter: 4, fromVerse: 31, toVerseChapter: 5, toVerse: 2,
};

function open(initialRef = passage) {
  const confirm = jest.fn();
  render(<ScriptureRefPicker initialRef={initialRef} mode="edit" onConfirm={confirm} onCancel={jest.fn()} />);
  return confirm;
}

describe('ScriptureRefPicker cross-chapter verse runs', () => {
  it('shows the last verse in its chapter and keeps it when the start verse changes', () => {
    const confirm = open();
    expect(screen.getByLabelText('studiesWorkspace.to')).toHaveDisplayValue('5:2');
    expect(screen.getByLabelText('studiesWorkspace.toChapter')).toHaveValue('5');
    fireEvent.change(screen.getByLabelText('studiesWorkspace.from'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm).toHaveBeenCalledWith({
      bible: 'kjv', book: 'Ephesians', chapter: 4, fromVerse: 30, endChapter: 5, toVerse: 2,
    });
  });

  it('opens a run carrying both end-chapter fields as verses rather than whole chapters', () => {
    const confirm = open({ ...passage, toChapter: 5 });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.from'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm.mock.calls[0][0]).toMatchObject({ fromVerse: 30, toVerse: 2, endChapter: 5 });
  });

  it('counts the end verse in its own chapter, even when it exceeds the start chapter length', () => {
    const confirm = open({ ...passage, toVerse: 33 });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.from'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm.mock.calls[0][0]).toMatchObject({ fromVerse: 30, toVerse: 33, endChapter: 5 });
  });

  it('lets a same-chapter passage choose its last chapter and verse', () => {
    const confirm = open({ id: 'single', bible: 'kjv', book: 'Ephesians', chapter: 4, fromVerse: 31 });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.toChapter'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.to'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm.mock.calls[0][0]).toMatchObject({ chapter: 4, fromVerse: 31, endChapter: 5, toVerse: 2 });
  });

  it('edits a reference mapped across a chapter seam without widening its end', () => {
    const confirm = open({ id: 'ps', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.from'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm.mock.calls[0][0]).toEqual({ bible: 'kjv', book: 'Psalms', chapter: 9, fromVerse: 18, endChapter: 10, toVerse: 4 });
  });

  it('preserves the original reference when its already-selected verse scope is pressed', () => {
    const confirm = open({ id: 'ps', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
    fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.scopeVerses' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 });
  });

  it('keeps the end when changing the start chapter resets an out-of-bounds start verse', () => {
    const confirm = open({ ...passage, toVerse: 33 });
    fireEvent.change(screen.getByLabelText('studiesWorkspace.chapter'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(confirm.mock.calls[0][0]).toMatchObject({ chapter: 3, fromVerse: 1, endChapter: 5, toVerse: 33 });
  });
});
