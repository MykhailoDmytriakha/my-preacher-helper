import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAnalysisBookMarks } from '@/components/bible/analysis/useAnalysisBookMarks';
import { useBookMarks } from '@/components/bible/marks/markStore';

import type { BookText } from '@/utils/bibleText';

/*
 * Codex, 04.11 (round 4): the marks' notice was tested only as a stand-in. Here the real notice (`DataSyncStatus`): the
 * book's form cannot open — the device's storage silent — and its Retry reaches the form.
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/components/bible/marks/markStore', () => ({ ...jest.requireActual('@/components/bible/marks/markStore'), useBookMarks: jest.fn() }));

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
