import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CrossReferenceSheet } from '@/components/bible/CrossReferenceSheet';
import { readCrossReferencePrefs, resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { bibleCrossRefsBase } from '@/utils/bibleCrossRefsCache';
import { crossReferencesAt, isMainReference, type CrossRefsBook } from '@/utils/crossReferences';

/*
 * The keyboard in a verse's links window. The rest's row has a chevron that is the row's button again for
 * a finger, taken out of the tab order; counted by the window's focus trap, Shift+Tab landed on it and Tab
 * left the window (Codex's review, 2026-10-16).
 */
const set: CrossRefsBook = JSON.parse(readFileSync(join(__dirname, '../../../public', bibleCrossRefsBase.slice(1), 'ruth.json'), 'utf8'));

/** The first verse of Ruth with both main links and others. */
const at = (() => {
  for (let chapter = 1; chapter <= 4; chapter += 1) {
    for (let verse = 1; verse <= 30; verse += 1) {
      const links = crossReferencesAt(set, 'rst', { book: 'Ruth', chapter, verse });
      if (links.some(isMainReference) && links.some((link) => !isMainReference(link))) return { chapter, verse };
    }
  }
  throw new Error('No verse of Ruth with both main and other links');
})();

const openWindow = () => {
  render(
    <>
      <button type="button">Outside</button>
      <CrossReferenceSheet at={at} bookId="Ruth" bible="rst" locale="en" set={set} onClose={jest.fn()} onOpenReference={jest.fn()} />
    </>
  );
  return screen.getByRole('dialog');
};

beforeEach(() => {
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  // The links' texts never arrive here: the window is about keys, not texts.
  global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
});

describe('the keyboard in a verse\'s links window', () => {
  it('Shift+Tab from Close goes to a control the keyboard can use, never to the chevron', async () => {
    const dialog = openWindow();
    within(dialog).getByRole('button', { name: 'common.close' }).focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).not.toHaveAttribute('aria-hidden', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab from the rest\'s row stays inside the window', async () => {
    const dialog = openWindow();
    within(dialog).getByRole('button', { name: 'bible.crossRefs.othersSection' }).focus();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('opens the rest and switches them to verses from the keyboard, the row staying open', async () => {
    const dialog = openWindow();
    const row = within(dialog).getByRole('button', { name: 'bible.crossRefs.othersSection' });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    await userEvent.tab();
    const asVerses = within(dialog).getByRole('switch', { name: 'bible.crossRefs.othersAsVerses' });
    expect(asVerses).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });
});
