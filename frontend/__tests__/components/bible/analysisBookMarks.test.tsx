import { render, renderHook, screen } from '@testing-library/react';
import { toast } from 'sonner';

import { useAnalysisBookMarks } from '@/components/bible/analysis/useAnalysisBookMarks';
import { useBookMarks } from '@/components/bible/marks/markStore';

jest.mock('sonner', () => ({ toast: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/components/bible/marks/markStore', () => ({ ...jest.requireActual('@/components/bible/marks/markStore'), useBookMarks: jest.fn() }));
jest.mock('@/data-engine/DataSyncStatus', () => ({
  DataSyncStatus: ({ status }: { status: { phase: string } | null }) => <div data-testid="marks-status">{status?.phase}</div>,
}));

const mockedBookMarks = useBookMarks as jest.MockedFunction<typeof useBookMarks>;
const text = { id: 'Ephesians', chapters: [['Павел, волею Божиею Апостол Иисуса Христа']] } as never;
const form = (phase: string) => ({ recoveryIdentity: {}, status: { phase }, state: {}, error: null, retry: jest.fn(), keepLocal: jest.fn(() => Promise.resolve()), acceptRemote: jest.fn(() => Promise.resolve()) });

describe('useAnalysisBookMarks — the book\'s marks of an analysis opened in Studies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps a stroke through the book\'s form while it can write', () => {
    const save = jest.fn();
    mockedBookMarks.mockReturnValue({ marks: {}, save, ready: true, writable: true, others: [], sync: null } as never);
    const { result } = renderHook(() => useAnalysisBookMarks({ bible: 'rst', bookId: 'Ephesians', text }));
    const change = jest.fn();
    expect(result.current.source?.mark(change, jest.fn())).toBe(true);
    expect(save).toHaveBeenCalledWith(change, expect.any(Function));
  });

  it('while marks wait for a choice, refuses a stroke, says to choose first, and offers the choice in its status', () => {
    // Codex, 02.11: no reader stands beside the analysis in Studies, so the choice must be offered in the analysis itself;
    // «wait» alone would never end.
    const save = jest.fn();
    mockedBookMarks.mockReturnValue({ marks: {}, save, ready: true, writable: false, others: [], sync: form('conflict') } as never);
    const { result } = renderHook(() => useAnalysisBookMarks({ bible: 'rst', bookId: 'Ephesians', text }));
    expect(result.current.source?.mark(jest.fn(), jest.fn())).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('bible.marks.decideFirst');
    render(<>{result.current.status}</>);
    expect(screen.getByTestId('marks-status')).toHaveTextContent('conflict');
  });

  it('says why marks cannot open — and offers to try again — even while no stroke can be drawn', () => {
    // Codex, 04.11: the book's form failing to open (the device's storage silent) left marks not ready, and the hook gave
    // nothing — the tools and the form's notice with its Retry went together, and the person was told nothing.
    mockedBookMarks.mockReturnValue({ marks: {}, save: jest.fn(), ready: false, writable: false, others: [], sync: form('localFailure') } as never);
    const { result } = renderHook(() => useAnalysisBookMarks({ bible: 'rst', bookId: 'Ephesians', text }));
    expect(result.current.source).toBeNull();
    render(<>{result.current.status}</>);
    expect(screen.getByTestId('marks-status')).toHaveTextContent('localFailure');
  });
});
