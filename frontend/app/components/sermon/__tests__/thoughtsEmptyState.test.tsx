import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ThoughtsEmptyState from '@/components/sermon/ThoughtsEmptyState';

import type { ScratchNote } from '@/models/models';

/**
 * AN EMPTY STATE DESCRIBES THE WORK, NOT THE FIELD.
 *
 * The line this replaced said "Нет мыслей для этой проповеди" on a sermon that had a linked
 * study and twenty-two atoms cut from it — a true statement about an empty array and a false
 * one about the sermon. What is asserted here is the division of labour that came out of it:
 * atoms belonging to a note are shown by the note and are never repeated here, atoms with no
 * note behind them have nowhere else to live and are shown here, and a sermon with nothing
 * anywhere is greeted with an invitation rather than a warning.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));

const anAtom = (id: string, text: string): ScratchNote => ({
  id,
  text,
  createdAt: '2026-09-02T00:00:00.000Z',
});

describe('nothing anywhere', () => {
  it('invites the first recording instead of reporting an empty list', () => {
    render(<ThoughtsEmptyState scratchNotes={[]} />);

    expect(screen.getByTestId('thoughts-empty-plain')).toBeInTheDocument();
    expect(screen.getByText('sermon.materialEmpty.plain')).toBeInTheDocument();
  });
});

describe('atoms with no note behind them', () => {
  it('shows them here, because there is no note to carry them', () => {
    render(<ThoughtsEmptyState scratchNotes={[anAtom('a1', 'записано голосом')]} />);

    expect(screen.getByTestId('thoughts-empty-atoms')).toHaveTextContent('записано голосом');
  });

  it('offers the way into the room where they are sorted', () => {
    const onOpenScratch = jest.fn();
    render(<ThoughtsEmptyState scratchNotes={[anAtom('a1', 'набросок')]} onOpenScratch={onOpenScratch} />);

    fireEvent.click(screen.getByTestId('thoughts-empty-sort'));

    expect(onOpenScratch).toHaveBeenCalledTimes(1);
  });

  it('keeps the count out of the sentence, where Russian grammar would break it', () => {
    render(<ThoughtsEmptyState scratchNotes={[anAtom('a1', 'один'), anAtom('a2', 'два')]} />);

    const band = screen.getByTestId('thoughts-empty-atoms');
    expect(band).toHaveTextContent('sermon.materialEmpty.atomsBandNoNote');
    expect(band).toHaveTextContent('2');
  });
});
