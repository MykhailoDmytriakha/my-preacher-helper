import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { useAnalysisBookMarks } from '@/components/bible/analysis/useAnalysisBookMarks';
import { useBookMarks } from '@/components/bible/marks/markStore';

import type { BookText } from '@/utils/bibleText';

/*
 * Codex, 04.11 (round 4): the marks' notice was tested only as a stand-in. Here the real notice (`DataSyncStatus`): the
 * book's form cannot open — the device's storage silent — and its Retry reaches the form.
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/components/bible/marks/markStore', () => ({ ...jest.requireActual('@/components/bible/marks/markStore'), useBookMarks: jest.fn() }));

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, options?: { meaning?: string }) => options?.meaning ? key + ': ' + options.meaning : key }),
}));

const text: BookText = { id: 'Ephesians', chapters: [['Павел, волею Божиею Апостол']] };
function Notice() {
  return <>{useAnalysisBookMarks({ bible: 'rst', bookId: 'Ephesians', text }).status}</>;
}

describe('the marks of an analysis opened in Studies, when the book\'s form cannot open', () => {
  it('says so with Retry, and Retry asks the form again', async () => {
    const retry = jest.fn(() => Promise.resolve());
    (useBookMarks as jest.Mock).mockReturnValue({
      marks: {}, save: jest.fn(), ready: false, writable: false, others: [],
      sync: { recoveryIdentity: {}, status: { phase: 'localFailure' }, state: null, error: null, retry, keepLocal: jest.fn(), acceptRemote: jest.fn() },
    });
    render(<Notice />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });
});

describe('resolving different Bible marks', () => {
  const checkpoint = (conflicts: unknown[]) => ({
    editGeneration: 2, remoteCandidate: { metadata: { generation: 'book', revision: 3 } }, conflicts,
  });
  const showConflict = (shown: ReturnType<typeof checkpoint>) => {
    const keep = jest.fn(() => Promise.resolve()), accept = jest.fn(() => Promise.resolve());
    (useBookMarks as jest.Mock).mockReturnValue({
      marks: {}, save: jest.fn(), ready: true, writable: false, others: [],
      sync: { recoveryIdentity: {}, status: { phase: 'conflict', canKeepLocal: true, canAcceptRemote: true },
        state: { checkpoint: shown }, error: null, retry: jest.fn(), keepLocal: keep, acceptRemote: accept },
    });
    render(<Notice />);
    return { keep, accept };
  };

  it('names the changed word and the two marks, and confirms before using the stored version', async () => {
    const shown = checkpoint([{
      path: ['verses', 'v1_1', 'm'], base: { exists: true, value: '0-0-yellow' },
      mine: { exists: true, value: '0-0-yellow,2-2-red' }, theirs: { exists: true, value: '0-0-yellow,2-2-blue' },
    }]);
    const { keep, accept } = showConflict(shown);
    const comparison = screen.getByRole('region', { name: 'dataSync.versionComparison' });
    const here = within(comparison).getByLabelText('dataSync.yourVersion');
    const saved = within(comparison).getByLabelText('dataSync.storedVersion');
    expect(here).toHaveTextContent('1:1 · Божиею');
    expect(here).toHaveTextContent('bible.marks.marker: bible.marks.meaning.red');
    expect(saved).toHaveTextContent('bible.marks.marker: bible.marks.meaning.blue');
    expect(here).not.toHaveTextContent('yellow');
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();

    fireEvent.click(within(comparison).getByRole('button', { name: 'bible.marks.conflictUseSaved' }));
    const question = await screen.findByRole('dialog');
    expect(question).toHaveTextContent('bible.marks.conflictDiscard.title');
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole('button', { name: 'bible.marks.conflictDiscard.confirm' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(shown));
    expect(keep).not.toHaveBeenCalled();
  });

  it('compares the results of the choices after keeping a separate saved word', () => {
    showConflict(checkpoint([{
      path: ['verses', 'v1_1', 'm'], base: { exists: false },
      mine: { exists: true, value: '0-0-red' }, theirs: { exists: true, value: '2-2-blue' },
    }]));
    const comparison = screen.getByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(comparison).getByLabelText('dataSync.yourVersion')).toHaveTextContent('Павел');
    expect(comparison).not.toHaveTextContent('Божиею');
  });

  it('uses mark-specific choices even when there are no readable mark differences', async () => {
    const shown = checkpoint([]);
    const { keep, accept } = showConflict(shown);
    expect(screen.getByRole('alert')).toHaveTextContent('bible.marks.conflictDescription');
    expect(screen.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.conflictKeepMine' }));
    await waitFor(() => expect(keep).toHaveBeenCalledWith(shown));
    expect(accept).not.toHaveBeenCalled();
  });
});
