import { render, screen, within } from '@testing-library/react';
import React from 'react';

import CarePage from '@/(pages)/(private)/care/page';
import '@testing-library/jest-dom';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

/**
 * The global `react-i18next` mock returns the KEY, so every assertion below reads as the
 * key the page asked for. That is on purpose: it proves the page reaches for the right
 * string, and the locale-coverage test at the bottom proves that string exists in all
 * three files. A test that asserted rendered Russian would pass while the English file
 * was empty.
 */

const mockPrayers: { status: string }[] = [];

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => ({ prayerRequests: mockPrayers }),
}));

/** Every section on the plane, grouped into the card it belongs to. */
const SECTIONS_BY_CARD = {
  people: ['people', 'visits', 'needs', 'council'],
  ministry: ['rites', 'crisis', 'word', 'projects'],
  own: ['prayers', 'promises', 'questions', 'beforeGod'],
} as const;

const CARDS = Object.keys(SECTIONS_BY_CARD) as (keyof typeof SECTIONS_BY_CARD)[];
const SECTIONS = CARDS.flatMap((card) => SECTIONS_BY_CARD[card]);

/** The sections that are built. Everything else must be inert and marked "soon". */
const BUILT: Record<string, string> = { prayers: '/prayers', rites: '/care/orders' };

describe('Pastor plane', () => {
  beforeEach(() => {
    mockPrayers.length = 0;
  });

  it('names the plane', () => {
    render(<CarePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('care.title');
  });

  it('lays out all three cards, so the map never depends on what is finished', () => {
    render(<CarePage />);

    CARDS.forEach((card) => {
      expect(screen.getByRole('heading', { name: `care.cards.${card}.title` })).toBeInTheDocument();
      expect(screen.getByText(`care.cards.${card}.hint`)).toBeInTheDocument();
    });
  });

  it('keeps all twelve sections on the plane, built or not', () => {
    render(<CarePage />);

    SECTIONS.forEach((section) => {
      const row = screen.getByTestId(`care-section-${section}`);
      expect(within(row).getByText(`care.sections.${section}.title`)).toBeInTheDocument();
      expect(within(row).getByText(`care.sections.${section}.hint`)).toBeInTheDocument();
    });
  });

  /**
   * The box a room lives in is its meaning, not decoration: the prayer journal belongs to
   * the pastor's own box, not to "people" — he is the one praying. This is the assertion
   * that catches a room quietly migrating between boxes on a later edit.
   */
  it('keeps every section inside its own card', () => {
    render(<CarePage />);

    CARDS.forEach((card) => {
      const box = screen.getByRole('region', { name: `care.cards.${card}.title` });
      SECTIONS_BY_CARD[card].forEach((section) => {
        expect(within(box).getByTestId(`care-section-${section}`)).toBeInTheDocument();
      });
    });
  });

  it('opens every built section at its own route', () => {
    render(<CarePage />);

    Object.entries(BUILT).forEach(([section, href]) => {
      const row = screen.getByTestId(`care-section-${section}`);
      expect(row.tagName).toBe('A');
      expect(row).toHaveAttribute('href', href);
      expect(within(row).queryByText('care.soon')).not.toBeInTheDocument();
    });
  });

  /**
   * A row that looks pressable and answers nothing is worse than one that says "soon".
   * This is the assertion that would catch someone wiring an unbuilt room to a dead route.
   */
  it('marks an unbuilt section "soon" and leaves it inert', () => {
    render(<CarePage />);

    SECTIONS.filter((key) => !BUILT[key]).forEach((section) => {
      const row = screen.getByTestId(`care-section-${section}`);
      expect(row.tagName).not.toBe('A');
      expect(row).not.toHaveAttribute('href');
      expect(within(row).getByText('care.soon')).toBeInTheDocument();
    });
  });

  /**
   * A number on a room is a promise that it is true. It counts the prayers standing OPEN,
   * not every row ever written, and a room with nothing to count shows no digit at all —
   * a decorative number teaches a person to stop believing the page.
   */
  it('counts only the prayers still standing open', () => {
    mockPrayers.push(
      { status: 'active' },
      { status: 'active' },
      { status: 'answered' },
      { status: 'not_answered' }
    );
    render(<CarePage />);

    const row = screen.getByTestId('care-section-prayers');
    expect(within(row).getByText('2')).toBeInTheDocument();
    // The digit alone tells a screen reader nothing: the words beside it say what it counts.
    expect(within(row).getByText('care.activePrayers')).toBeInTheDocument();
  });

  it('shows no number on the prayer journal when nothing is open', () => {
    mockPrayers.push({ status: 'answered' });
    render(<CarePage />);

    const row = screen.getByTestId('care-section-prayers');
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('has every string it asks for in all three locales', () => {
    const keys = [
      'care.title', 'care.soon', 'care.soonHint', 'care.activePrayers',
      'navigation.care',
      ...CARDS.flatMap((c) => [`care.cards.${c}.title`, `care.cards.${c}.hint`]),
      ...SECTIONS.flatMap((s) => [`care.sections.${s}.title`, `care.sections.${s}.hint`]),
    ];

    const read = (dict: Record<string, unknown>, path: string) =>
      path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);

    ([['en', en], ['ru', ru], ['uk', uk]] as const).forEach(([lang, dict]) => {
      keys.forEach((key) => {
        const value = read(dict as unknown as Record<string, unknown>, key);
        if (typeof value !== 'string' || !value.length) {
          throw new Error(`Missing ${key} in ${lang}`);
        }
        expect(typeof value).toBe('string');
      });
    });
  });
});
