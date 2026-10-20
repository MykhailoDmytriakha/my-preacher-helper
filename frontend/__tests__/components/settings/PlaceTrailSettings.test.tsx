import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { arriveOnTrail, readPlaceTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import PlaceTrailSettings from '@/components/settings/PlaceTrailSettings';

/*
 * The trail of places in the settings' "Bible" section (the owner, 2026-10-20: not in the reader's "T"):
 * how many places it keeps and how many of the last ones are recent, on this device.
 */
beforeEach(() => {
  window.localStorage.clear();
  resetPlaceTrailForTests();
});

const group = (name: string) => screen.getByRole('group', { name });

describe('PlaceTrailSettings', () => {
  it('shows the history and the recent places with the device\'s choice pressed: 30 and 7 at first', () => {
    render(<PlaceTrailSettings />);
    expect(screen.getByRole('heading', { name: 'settings.bible.trail.title' })).toBeInTheDocument();
    expect(within(group('settings.bible.trail.history')).getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group('settings.bible.trail.recent')).getByRole('button', { name: '7' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group('settings.bible.trail.history')).getAllByRole('button').map((button) => button.textContent)).toEqual(['10', '30', '50', '100']);
    expect(within(group('settings.bible.trail.recent')).getAllByRole('button').map((button) => button.textContent)).toEqual(['5', '7', '10']);
  });

  it('a shorter history keeps only the newest places of the trail, at once', async () => {
    ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings']
      .forEach((book) => arriveOnTrail({ book, chapter: 1, verse: 1, bible: 'rst' }));
    render(<PlaceTrailSettings />);
    await userEvent.click(within(group('settings.bible.trail.history')).getByRole('button', { name: '10' }));
    expect(within(group('settings.bible.trail.history')).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');
    expect(readPlaceTrail().links).toHaveLength(10);
    expect(readPlaceTrail().links[0].book).toBe('Leviticus');
  });

  it('the recent places chosen decide what a move adds: with 5, a place six links back joins the end again', async () => {
    render(<PlaceTrailSettings />);
    await userEvent.click(within(group('settings.bible.trail.recent')).getByRole('button', { name: '5' }));
    const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua'];
    books.forEach((book) => arriveOnTrail({ book, chapter: 1, verse: 1, bible: 'rst' }));
    arriveOnTrail({ book: 'Genesis', chapter: 1, verse: 1, bible: 'rst' });
    expect(readPlaceTrail().links.map((link) => link.book)).toEqual([...books, 'Genesis']);
  });
});
