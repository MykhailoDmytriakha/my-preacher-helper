import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CrossReferenceSheet } from '@/components/bible/CrossReferenceSheet';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { getBookIds } from '@/utils/bibleBooks';
import { verseWords, type BookText } from '@/utils/bibleText';
import { crossReferenceLabel, crossReferencesAt, type CrossRefsBook } from '@/utils/crossReferences';

const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));

it('keeps the first chapter part of a mapped multi-chapter passage highlighted in its full-chapter card', async () => {
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  const set: CrossRefsBook = { id: 'Ruth', chapters: [[[getBookIds().indexOf('Numbers'), 29, 12, 40, 3]]] };
  const reference = crossReferencesAt(set, 'rst', { book: 'Ruth', chapter: 1, verse: 1 })[0];
  expect(reference).toMatchObject({ book: 'Numbers', chapter: 29, fromVerse: 12, endChapter: 30, toVerse: 1 });
  global.fetch = jest.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => publicFile(url.slice(1)),
    clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }),
  })) as unknown as typeof fetch;

  render(<CrossReferenceSheet at={{ chapter: 1, verse: 1 }} bookId="Ruth" bible="rst" locale="en"
    set={set} onClose={jest.fn()} onOpenReference={jest.fn()} />);
  const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
  const label = crossReferenceLabel(reference, 'rst', 'en');
  await userEvent.click(await within(list).findByText(label));
  const detail = screen.getByRole('dialog', { name: label });
  await within(detail).findByText('bible.crossRefs.chapterEnd');

  const verses = (publicFile('bible-text/rst/v1/numbers.json') as BookText).chapters[28];
  const lit = Array.from(detail.querySelectorAll('[data-arrival="on"]'));
  expect(lit).toHaveLength(verses.length - 12 + 1);
  expect(lit[0].textContent).toContain(verseWords(verses[11]));
  expect(lit[lit.length - 1].textContent).toContain(verseWords(verses[verses.length - 1]));
  await waitFor(() => expect(detail.querySelector('[data-verse], [data-verse-text]')).toBeNull());
});
