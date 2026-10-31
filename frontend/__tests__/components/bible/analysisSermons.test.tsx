import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AnalysisSermons, AnalysisSermonsPanel } from '@/components/bible/analysis/AnalysisSermons';
import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { useEngineSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';

import type { Sermon } from '@/models/models';

/*
 * An analysis's sermons by its name (case 2026-10-12-block-diagram, phase 7, case 1; the owner's choice 30.10): «Проповедь
 * +» while none is made from it, the app's own «Новая проповедь» with the passage written and the analysis linked; then
 * each sermon a capsule with its title that opens it, and «+» for another. The dialog itself is tested on the real
 * engine (EngineCreateSermonModal.test.tsx); here, what the capsule hands it.
 */
jest.mock('@/hooks/useSermonNoteLinks', () => ({ ...jest.requireActual('@/hooks/useSermonNoteLinks'), useEngineSermonsBuiltOnNote: jest.fn() }));
jest.mock('@/components/sermon/EngineCreateSermonModal', () => ({
  EngineCreateSermonModal: jest.fn(({ verseNote, onQueued }: { verseNote: React.ReactNode; onQueued: (id: string) => void }) => (
    <div role="dialog" aria-label="new sermon">{verseNote}<button type="button" onClick={() => onQueued('new-1')}>save</button></div>
  )),
}));

// The passage as the reader's «Копировать» gives it (passageCopyText): the new sermon's verse (the owner, 31.10).
const COPIED = 'Еф 1:3–4: "Благословен Бог и Отец Господа нашего Иисуса Христа, благословивший нас… так как Он избрал нас в Нем…"';
const sermons = (list: Array<Partial<Sermon>>) => jest.mocked(useEngineSermonsBuiltOnNote).mockReturnValue(list as Sermon[]);

describe('an analysis\'s sermons by its name', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers «Проповедь +» while none is made from it, and opens «Новая проповедь» with the passage in full and the analysis', async () => {
    sermons([]);
    render(<AnalysisSermons noteId="analysis-1" place="Еф 1:3–14" verse={COPIED} onOpen={jest.fn()} />);
    const capsule = screen.getByRole('button', { name: 'analysis.sermon.newAria' });
    expect(capsule).toHaveTextContent('analysis.sermon.new');
    await userEvent.click(capsule);
    expect(jest.mocked(EngineCreateSermonModal).mock.calls[0][0]).toMatchObject({ initialVerse: COPIED, sourceNoteIds: ['analysis-1'], layerClassName: 'z-[130]' });
    const dialog = screen.getByRole('dialog', { name: 'new sermon' });
    expect(within(dialog).getByText('analysis.title')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('analysis.sermon.linked');
    // Saved: the dialog goes, the person stays where they read.
    await userEvent.click(within(dialog).getByRole('button', { name: 'save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names each sermon made from it — a press opens it — and «+» makes another', async () => {
    sermons([{ id: 's1', title: 'Благословен Бог' }, { id: 's2', title: '  ' }]);
    const onOpen = jest.fn();
    render(<AnalysisSermons noteId="analysis-1" place="Еф 1:3–14" verse={COPIED} onOpen={onOpen} />);
    expect(screen.queryByRole('button', { name: 'analysis.sermon.newAria' })).not.toBeInTheDocument();
    const opens = screen.getAllByRole('button', { name: 'analysis.sermon.open' });
    expect(opens).toHaveLength(2);
    await userEvent.click(opens[0]);
    expect(onOpen).toHaveBeenCalledWith('/sermons/s1');
    expect(screen.getByText('Благословен Бог')).toBeInTheDocument();
    expect(screen.getByText('analysis.sermon.untitled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'analysis.sermon.another' }));
    expect(jest.mocked(EngineCreateSermonModal)).toHaveBeenCalled();
    expect(useEngineSermonsBuiltOnNote).toHaveBeenCalledWith('analysis-1');
  });
});

// The owner, 31.10: three sermons' capsules crowded the analysis page's header — «нужно это сюда, в правую колонку».
describe('an analysis\'s sermons in its page\'s side panel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the sermons made from it as a study note lists its own, each opening its sermon the reader\'s way', async () => {
    sermons([{ id: 's1', title: 'Испытывайте духов', verse: '1Ин 4:1–3', date: '2026-10-31' }, { id: 's2', title: '' }]);
    const onOpen = jest.fn();
    render(<AnalysisSermonsPanel noteId="analysis-1" place="1Ин 4:1–3" verse={COPIED} onOpen={onOpen} />);
    const panel = screen.getByTestId('analysis-sermons-panel');
    expect(within(panel).getByText('analysis.sermon.title')).toBeInTheDocument();
    expect(within(panel).getByTestId('built-sermons-count')).toHaveTextContent('2');
    expect(within(panel).getAllByTestId('built-sermon-title').map((title) => title.textContent)).toEqual(['Испытывайте духов', 'analysis.sermon.untitled']);
    await userEvent.click(within(panel).getAllByTestId('built-sermon-link')[0]);
    expect(onOpen).toHaveBeenCalledWith('/sermons/s1');
  });

  it('says none is made yet, and its door opens «Новая проповедь» with the passage in full', async () => {
    sermons([]);
    render(<AnalysisSermonsPanel noteId="analysis-1" place="Еф 1:3–14" verse={COPIED} onOpen={jest.fn()} />);
    expect(screen.getByTestId('built-sermons-empty')).toHaveTextContent('analysis.sermon.empty');
    await userEvent.click(screen.getByRole('button', { name: 'analysis.sermon.create' }));
    expect(jest.mocked(EngineCreateSermonModal).mock.calls[0][0]).toMatchObject({ initialVerse: COPIED, sourceNoteIds: ['analysis-1'] });
  });
});
