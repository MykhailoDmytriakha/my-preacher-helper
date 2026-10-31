import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { ReaderAnalysis } from '@/components/bible/analysis/ReaderAnalysis';
import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';
import type { VerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import type { AnalysisOpening } from '@/components/bible/analysis/useAnalysisNote';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner' }) }));
jest.mock('@/components/bible/analysis/useAnalysisReshape', () => ({ useAnalysisReshape: jest.fn() }));
jest.mock('@/components/bible/analysis/AnalysisEditor', () => ({ AnalysisEditor: ({ onEditVerses }: { onEditVerses: (id: string, passage: object) => void }) =>
  <button onClick={() => onEditVerses('source', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 })}>Change verses</button> }));
jest.mock('@/components/bible/verseCopy/VerseCopyBar', () => ({ VerseCopyBar: () => null }));
const deferred = () => { let resolve!: (value: string | null) => void, reject!: (error: unknown) => void;
  const promise = new Promise<string | null>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const props = () => ({ copy: { purpose: 'analysis', picking: true, picked: [{ chapter: 1, verse: 1 }],
  passage: { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }, placeOf: () => 'Ephesians 1:1', clear: jest.fn(), startPassage: jest.fn() } as unknown as VerseCopy,
  text: { id: 'Ephesians', chapters: [['Alpha', 'Beta']] }, wide: true, bookId: 'Ephesians', bible: 'rst' as const, locale: 'en' as const,
  opening: { kind: 'open', id: 'source', editing: true } as AnalysisOpening, onOpening: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); });

it('keeps the selection and original editor when whole-action capture refuses', async () => {
  jest.mocked(useAnalysisReshape).mockReturnValue(jest.fn().mockRejectedValue(Object.assign(new Error('Resolve the destination first'), { code: 'resolve-version-first' })));
  const p = props(); render(<ReaderAnalysis {...p} />);
  fireEvent.click(screen.getByText('Change verses')); p.onOpening.mockClear();
  await act(async () => { fireEvent.click(screen.getByText('analysis.pick.apply')); });
  expect(p.copy.clear).not.toHaveBeenCalled();
  expect(p.onOpening).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByText('analysis.pick.apply')).toBeEnabled();
});

it('locks duplicate Apply and opens only after the durable capture, with neutral feedback', async () => {
  const pending = deferred(), reshape = jest.fn(() => pending.promise);
  jest.mocked(useAnalysisReshape).mockReturnValue(reshape);
  const p = props(); render(<ReaderAnalysis {...p} />);
  fireEvent.click(screen.getByText('Change verses')); p.onOpening.mockClear();
  fireEvent.click(screen.getByText('analysis.pick.apply')); fireEvent.click(screen.getByText('analysis.pick.apply'));
  expect(reshape).toHaveBeenCalledTimes(1);
  expect(screen.getByText('analysis.pick.apply')).toBeDisabled();
  expect(p.copy.clear).not.toHaveBeenCalled();
  expect(p.onOpening).not.toHaveBeenCalled();
  await act(async () => { pending.resolve('Changed locally'); });
  expect(p.copy.clear).toHaveBeenCalledTimes(1);
  expect(p.onOpening).toHaveBeenCalledWith({ kind: 'open', id: 'source', editing: true });
  expect(toast).toHaveBeenCalledWith('analysis.reshape.prepared');
  expect(toast.success).not.toHaveBeenCalled();
});

it('does not open an old analysis or clear the next book after navigation during capture', async () => {
  const pending = deferred(); jest.mocked(useAnalysisReshape).mockReturnValue(() => pending.promise);
  const p = props(), view = render(<ReaderAnalysis {...p} />);
  fireEvent.click(screen.getByText('Change verses')); p.onOpening.mockClear();
  fireEvent.click(screen.getByText('analysis.pick.apply'));
  view.rerender(<ReaderAnalysis {...p} bookId="Galatians" />);
  await act(async () => { pending.resolve('Old book changed locally'); });
  expect(p.onOpening).not.toHaveBeenCalled(); expect(p.copy.clear).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
});
