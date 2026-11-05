import { act, fireEvent, render, screen } from '@testing-library/react';

import { AnalysisEditor } from '@/components/bible/analysis/AnalysisEditor';
import { resetAnalysisHelpPrefsForTests } from '@/components/bible/analysis/analysisHelpPrefs';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';

import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * BUG-20261030-analysis-other-bible-overwrite: an analysis's parts stand on word numbers of the Bible it was made in. Opened
 * over the reader's other Bible — from «Моё», or by an address after another Bible was chosen in this visit — it laid its
 * parts on that Bible's words, and the first change wrote them over. Wherever it is opened from, an analysis is laid only
 * on its own Bible's words: over another it shows none, changes nothing, and offers its own Bible.
 */
jest.mock('@/hooks/useStudyNotesEngine', () => ({ ...jest.requireActual('@/hooks/useStudyNotesEngine'), useStudyNotesEngine: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataDocument: jest.fn() }));

const EPHESIANS: BookText = { id: 'Ephesians', chapters: [['¶Павел, волею Божиею Апостол Иисуса Христа, находящимся в Ефесе святым и верным во Христе Иисусе:', 'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.']] };
const total = passageWords(EPHESIANS, { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 }).length;
const ANALYSIS: StudyNote = {
  id: 'an-1', userId: 'u', content: '', title: 'Разбор', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '', type: 'analysis',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words: total, cuts: [3], links: {}, relations: {} },
};
const commit = jest.fn(() => Promise.resolve());

describe('an analysis opened over another Bible', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAnalysisHelpPrefsForTests();
    commit.mockClear();
    (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({ uid: 'u', notes: [ANALYSIS], loading: false, checking: false, createNote: jest.fn(), updateNote: jest.fn() }));
    (useDataDocument as jest.Mock).mockImplementation((resource: { id: string } | null) => ({
      data: resource ? ANALYSIS : null, state: resource ? {} : null, status: resource ? { phase: 'saved' } : null,
      readOnly: false, loading: false, error: null, commit, recoveryIdentity: {},
    }));
  });

  it('lays none of its parts on that Bible\'s words, changes nothing, and offers its own Bible', () => {
    const onUseBible = jest.fn();
    const { container } = render(
      <AnalysisEditor opening={{ kind: 'open', id: 'an-1', editing: true }} text={EPHESIANS} bookId="Ephesians" bible="kjv" locale="ru" onClose={jest.fn()} onUseBible={onUseBible} onEditVerses={jest.fn()} />,
    );
    expect(screen.getByText('analysis.otherBible.text')).toBeInTheDocument();
    expect(container.querySelector('[data-line]')).toBeNull();
    expect(screen.queryByText(/Павел/)).not.toBeInTheDocument();
    // Nor its verses chosen again on this Bible's text: that too would write it over.
    expect(screen.queryByRole('button', { name: 'analysis.editVerses' })).not.toBeInTheDocument();
    // Nor a mode to switch or a change to undo: nothing here changes it.
    expect(screen.queryByRole('group', { name: 'analysis.modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /analysis.undo/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'analysis.otherBible.open' }));
    expect(onUseBible).toHaveBeenCalledWith('rst');
    expect(commit).not.toHaveBeenCalled();
  });

  // The live check, 05.11: «Перейти на «Синодальный»» turned the reader to that Bible, and the analysis was gone — the
  // window, unmounted with the reader it stood in, took its address with it. Turned to its Bible, it opens there again.
  it('keeps its address when its own Bible is chosen, so the reader in that Bible opens it again', async () => {
    window.history.replaceState(null, '', '/bible?book=ephesians');
    const { unmount } = render(
      <AnalysisEditor opening={{ kind: 'open', id: 'an-1', editing: false }} text={EPHESIANS} bookId="Ephesians" bible="kjv" locale="ru" onClose={jest.fn()} onUseBible={jest.fn()} />,
    );
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('an-1');
    fireEvent.click(screen.getByRole('button', { name: 'analysis.otherBible.open' }));
    unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('an-1');
    window.history.replaceState(null, '', '/');
  });

  it('opened over its own Bible, is laid as always', () => {
    render(<AnalysisEditor opening={{ kind: 'open', id: 'an-1', editing: false }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={jest.fn()} />);
    expect(screen.queryByText('analysis.otherBible.text')).not.toBeInTheDocument();
    expect(document.querySelector('[data-line]')).not.toBeNull();
  });
});
