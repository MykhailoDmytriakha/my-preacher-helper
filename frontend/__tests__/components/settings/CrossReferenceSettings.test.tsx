import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BibleSettingsPage from '@/(pages)/(private)/settings/bible/page';
import { readCrossReferencePrefs, resetCrossReferencePrefsForTests, saveCrossReferencePrefs } from '@/components/bible/crossReferencePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import CrossReferenceSettings from '@/components/settings/CrossReferenceSettings';
import { diagnosticEvents } from '@/utils/appDiagnostics';

/*
 * Cross references in the settings' "Bible" section (the owner, 2026-10-20: out of the reader's "T",
 * which is about the text) — the same device choice the reader and the window's switch read.
 */
beforeEach(() => {
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
});

describe('CrossReferenceSettings', () => {
  it('shows the choice of the device; off, its sub-rows rest', async () => {
    render(<CrossReferenceSettings />);
    const settings = screen.getByTestId('cross-reference-settings');
    const [show, inWindow] = within(settings).getAllByRole('switch');
    expect(show).toBeChecked();
    expect(inWindow).not.toBeChecked();

    await userEvent.click(within(settings).getByRole('button', { name: 'bible.crossRefs.all' }));
    expect(readCrossReferencePrefs().mode).toBe('all');
    await userEvent.click(show);
    expect(readCrossReferencePrefs().show).toBe(false);
    expect(inWindow).toBeDisabled();
    expect(within(settings).getByRole('button', { name: 'bible.crossRefs.main' })).toBeDisabled();
    expect(diagnosticEvents().at(-1)?.data).toEqual(expect.objectContaining({ source: 'settings', code: 'crossRefs-show', result: 'off' }));
  });

  it('carries the window\'s "the rest as verses" switch too: one choice for both', async () => {
    render(<CrossReferenceSettings />);
    const asVerses = screen.getByRole('switch', { name: 'bible.crossRefs.othersAsVersesSetting' });
    expect(asVerses).not.toBeChecked();
    await userEvent.click(asVerses);
    expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    expect(asVerses).toBeChecked();
    act(() => saveCrossReferencePrefs({ othersAsVerses: false }, 'window'));
    expect(asVerses).not.toBeChecked();
  });

  it('the "Bible" section holds the cross references, then the trail of places, and says both stay on this device', () => {
    render(<BibleSettingsPage />);
    const references = screen.getByTestId('cross-reference-settings');
    const trail = screen.getByTestId('place-trail-settings');
    expect(references.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('settings.bible.device')).toBeInTheDocument();
  });
});
