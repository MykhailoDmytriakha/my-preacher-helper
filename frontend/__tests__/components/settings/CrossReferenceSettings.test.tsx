import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BibleSettingsPage from '@/(pages)/(private)/settings/bible/page';
import { readCrossReferencePrefs, resetCrossReferencePrefsForTests, saveCrossReferencePrefs } from '@/components/bible/crossReferencePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import CrossReferenceSettings, { CROSS_REFERENCE_SAMPLE } from '@/components/settings/CrossReferenceSettings';
import { diagnosticEvents } from '@/utils/appDiagnostics';
import { crossReferencesAt, crossRefsUrl, isMainReference } from '@/utils/crossReferences';

/*
 * Cross references in the settings' "Bible" section (the owner, 2026-10-20: out of the reader's "T",
 * which is about the text; then "a person who knows nothing of the code must understand it") — the same
 * device choice the reader and the list's switch read, each row named by what the person sees.
 */
beforeEach(() => {
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
});

const group = (name: string) => screen.getByRole('group', { name });
const sampleChip = () => within(screen.getByTestId('cross-reference-sample')).queryByTestId('cross-reference-sample-chip');

describe('CrossReferenceSettings', () => {
  it('shows the choice of the device; off, the rest is dimmed and disabled, and a line says why', async () => {
    render(<CrossReferenceSettings />);
    const marks = screen.getByRole('switch', { name: 'settings.bible.crossRefs.marks' });
    const inWindow = screen.getByRole('switch', { name: 'settings.bible.crossRefs.inWindow' });
    expect(marks).toBeChecked();
    expect(inWindow).not.toBeChecked();
    expect(screen.queryByText('settings.bible.crossRefs.off')).not.toBeInTheDocument();

    await userEvent.click(within(group('settings.bible.crossRefs.count')).getByRole('button', { name: 'settings.bible.crossRefs.countAll' }));
    expect(readCrossReferencePrefs().mode).toBe('all');
    await userEvent.click(marks);
    expect(readCrossReferencePrefs().show).toBe(false);
    expect(inWindow).toBeDisabled();
    expect(within(group('settings.bible.crossRefs.count')).getByRole('button', { name: 'settings.bible.crossRefs.countMain' })).toBeDisabled();
    expect(within(group('settings.bible.crossRefs.others')).getByRole('button', { name: 'settings.bible.crossRefs.othersVerses' })).toBeDisabled();
    expect(screen.getByText('settings.bible.crossRefs.off')).toBeInTheDocument();
    expect(diagnosticEvents().at(-1)?.data).toEqual(expect.objectContaining({ source: 'settings', code: 'crossRefs-show', result: 'off' }));
  });

  it('the sample verse shows what the choices do: 13 with the main places, 92 with all, no badge while off', async () => {
    render(<CrossReferenceSettings />);
    expect(sampleChip()).toHaveTextContent(/^13$/);
    await userEvent.click(within(group('settings.bible.crossRefs.count')).getByRole('button', { name: 'settings.bible.crossRefs.countAll' }));
    expect(sampleChip()).toHaveTextContent(/^92$/);
    await userEvent.click(screen.getByRole('switch', { name: 'settings.bible.crossRefs.marks' }));
    expect(sampleChip()).not.toBeInTheDocument();
  });

  // A person who looks the sample up in the Bible finds what the settings said, whichever Bible they read.
  it('the sample\'s numbers are John 3:16\'s own in the set, in every Bible of the app', () => {
    const { book, chapter, verse, main, total } = CROSS_REFERENCE_SAMPLE;
    const set = JSON.parse(readFileSync(join(process.cwd(), 'public', crossRefsUrl(book)), 'utf8'));
    for (const bible of ['rst', 'ubio', 'kjv'] as const) {
      const references = crossReferencesAt(set, bible, { book, chapter, verse });
      expect({ bible, main: references.filter(isMainReference).length, total: references.length }).toEqual({ bible, main, total });
    }
  });

  it('the list\'s other places are two words, one choice with the list\'s own switch', async () => {
    render(<CrossReferenceSettings />);
    const looks = group('settings.bible.crossRefs.others');
    expect(within(looks).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'settings.bible.crossRefs.othersAddresses',
      'settings.bible.crossRefs.othersVerses',
    ]);
    expect(within(looks).getByRole('button', { name: 'settings.bible.crossRefs.othersAddresses' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(looks).getByRole('button', { name: 'settings.bible.crossRefs.othersVerses' }));
    expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    expect(within(looks).getByRole('button', { name: 'settings.bible.crossRefs.othersVerses' })).toHaveAttribute('aria-pressed', 'true');
    act(() => saveCrossReferencePrefs({ othersAsVerses: false }, 'window'));
    expect(within(looks).getByRole('button', { name: 'settings.bible.crossRefs.othersAddresses' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the "Bible" section holds the cross references, then the trail of places, and says both stay on this device', () => {
    render(<BibleSettingsPage />);
    const references = screen.getByTestId('cross-reference-settings');
    const trail = screen.getByTestId('place-trail-settings');
    expect(references.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('settings.bible.device')).toBeInTheDocument();
  });
});
