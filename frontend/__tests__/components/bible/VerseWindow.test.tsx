import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

import '@testing-library/jest-dom';
import { CrossReferenceSheet } from '@/components/bible/CrossReferenceSheet';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { ScriptureLinks, ScriptureText } from '@/components/bible/ScriptureLinks';
import { VerseSheet } from '@/components/bible/VerseSheet';
import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import ScriptureOpening from '@/components/common/ScriptureOpening';
import StudyNoteCard from '@/(pages)/(private)/studies/StudyNoteCard';
import { leadingReference } from '@/utils/bibleLink';
import { fetchBookText } from '@/utils/bibleText';
import { bibleCrossRefsBase } from '@/utils/bibleCrossRefsCache';
import { crossReferenceLabel, crossReferencesAt, isMainReference, type CrossRefsBook } from '@/utils/crossReferences';

import type { StudyNote } from '@/models/models';

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));

const ruth = { id: 'Ruth', chapters: [['¶Первый', 'Второй', 'Третий'], ['¶Глава два'], ['¶Глава три'], ['¶Глава четыре']] };
const push = jest.fn();
// The module's own mock (jest.setup.js): a namespace import is a copy, and a spy on it reaches no screen.
const navigation = jest.requireMock<{ useRouter: () => unknown; usePathname: jest.Mock }>('next/navigation');

beforeEach(() => {
  window.localStorage.setItem('bible:translation', 'rst');
  jest.mocked(fetchBookText).mockReset();
  jest.mocked(fetchBookText).mockResolvedValue(ruth as never);
  push.mockReset();
  jest.spyOn(navigation, 'useRouter').mockReturnValue({ push });
  navigation.usePathname.mockReturnValue('/sermons/s1');
});

afterEach(() => {
  jest.restoreAllMocks();
  navigation.usePathname.mockReturnValue('/');
});

// The owner, 2026-10-21: a reference in a sermon's thoughts took him to the Bible page — "let it just open in a window".
describe('ScriptureLinksInWindow — a pressed reference opens over the page', () => {
  it('opens the passage over the page and leaves the page where it is', async () => {
    render(<ScriptureLinksInWindow><p><ScriptureText text="Прочитайте Руфь 1:2" /></p></ScriptureLinksInWindow>);
    fireEvent.click(screen.getByRole('button', { name: 'Руфь 1:2' }));
    expect(await screen.findByRole('dialog', { name: 'Руфь 1:2' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('goes to the Bible at the passage from the window, the way back this page, and closes the window', async () => {
    render(<ScriptureLinksInWindow><p><ScriptureText text="Прочитайте Руфь 1:2" /></p></ScriptureLinksInWindow>);
    fireEvent.click(screen.getByRole('button', { name: 'Руфь 1:2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:2' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'bible.sheet.openInBible' }));
    const href = new URL(String(push.mock.calls[0]?.[0]), 'https://app.test');
    expect(href.pathname).toBe('/bible');
    expect(href.searchParams.get('book')).toBe('ruth');
    expect(href.searchParams.get('at')).toBe('1:2');
    expect(href.searchParams.get('tr')).toBe('rst');
    expect(href.searchParams.get('from')).toBe('/sermons/s1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers no way to the Bible where leaving would lose unsaved words', async () => {
    render(<ScriptureLinksInWindow toBible={false}><p><ScriptureText text="Руфь 1:2" /></p></ScriptureLinksInWindow>);
    fireEvent.click(screen.getByRole('button', { name: 'Руфь 1:2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:2' });
    expect(within(dialog).queryByRole('button', { name: 'bible.sheet.openInBible' })).toBeNull();
  });

  it('saves what is edited before the Bible page opens, and stays when the save refuses', async () => {
    const beforeSwitch = jest.fn().mockResolvedValue(false);
    render(<ScriptureLinksInWindow beforeSwitch={beforeSwitch}><p><ScriptureText text="Руфь 1:2" /></p></ScriptureLinksInWindow>);
    fireEvent.click(screen.getByRole('button', { name: 'Руфь 1:2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:2' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'bible.sheet.openInBible' }));
    });
    expect(beforeSwitch).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    // Codex's review, 2026-10-21: the refused save closed the window and the place read in it.
    expect(screen.getByRole('dialog', { name: 'Руфь 1:2' })).toBeInTheDocument();
  });

  it("opens a sermon's verse over the page too, not through its own way to the Bible", async () => {
    const onOpen = jest.fn();
    const verse = 'Руфь 1:2 — и сказала';
    render(
      <ScriptureLinksInWindow>
        <ScriptureOpening text={verse} reference={leadingReference(verse, { locale: 'ru', from: '/sermons/s1' })} onOpen={onOpen} />
      </ScriptureLinksInWindow>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Руфь 1:2' }));
    expect(await screen.findByRole('dialog', { name: 'Руфь 1:2' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('a note card on the list of notes', () => {
  const note = {
    id: 'n1', userId: 'u1', title: 'Руфь', content: 'Верность', tags: [], type: 'note', isDraft: false,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    scriptureRefs: [{ id: 'r1', book: 'Ruth', chapter: 1, fromVerse: 16, bible: 'rst' }],
  } as unknown as StudyNote;

  it('opens a reference chip the way the list opens references, not the Bible page', () => {
    const onOpen = jest.fn();
    render(
      <ScriptureLinks onOpen={onOpen}>
        <StudyNoteCard note={note} bibleLocale="ru" isExpanded onToggleExpand={jest.fn()} onEdit={jest.fn()} />
      </ScriptureLinks>
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Руфь 1:16/ })[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }));
    expect(push).not.toHaveBeenCalled();
  });
});

// Codex's review, 2026-10-21: a cross-reference's "Open" in the window left a sermon being preached and a
// plan point being edited — the window's every way out is the screen's.
describe('the window leaves only by the screen\'s own way out', () => {
  const set: CrossRefsBook = JSON.parse(readFileSync(join(__dirname, '../../../public', bibleCrossRefsBase.slice(1), 'ruth.json'), 'utf8'));
  const at = (() => {
    for (let chapter = 1; chapter <= 4; chapter += 1) {
      for (let verse = 1; verse <= 30; verse += 1) {
        if (crossReferencesAt(set, 'rst', { book: 'Ruth', chapter, verse }).some(isMainReference)) return { chapter, verse };
      }
    }
    throw new Error('No verse of Ruth with a main link');
  })();
  const firstMain = crossReferencesAt(set, 'rst', { book: 'Ruth', ...at }).find(isMainReference)!;

  beforeEach(() => {
    window.localStorage.clear();
    resetCrossReferencePrefsForTests();
    global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
  });

  it('reads a cross-reference in place, with no "Open", where the screen may not be left', async () => {
    render(<CrossReferenceSheet at={at} bookId="Ruth" bible="rst" locale="en" set={set} onClose={jest.fn()} />);
    await userEvent.click(screen.getByText(crossReferenceLabel(firstMain, 'rst', 'en')));
    expect(screen.getByRole('heading', { name: crossReferenceLabel(firstMain, 'rst', 'en') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bible.crossRefs.open' })).toBeNull();
  });

  it('offers "Open" where the screen gives a way out', async () => {
    const onOpenReference = jest.fn();
    render(<CrossReferenceSheet at={at} bookId="Ruth" bible="rst" locale="en" set={set} onClose={jest.fn()} onOpenReference={onOpenReference} />);
    await userEvent.click(screen.getByText(crossReferenceLabel(firstMain, 'rst', 'en')));
    await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
    expect(onOpenReference).toHaveBeenCalledWith(firstMain, at);
  });
});

// Codex's review, 2026-10-21: a book named whole on a note's chip said "no such book or chapter".
describe('a book named whole', () => {
  it('opens at its start with nothing lit and no "not found"', async () => {
    render(<VerseSheet reference={{ bible: 'rst', book: 'Ruth', label: 'Руфь' }} onClose={jest.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь' });
    await waitFor(() => expect(dialog.querySelector('[data-verse="1:1"]')).not.toBeNull());
    expect(within(dialog).queryByText('bible.goToNotFound')).toBeNull();
    expect(dialog.querySelectorAll('[data-arrival="on"]')).toHaveLength(0);
  });
});
