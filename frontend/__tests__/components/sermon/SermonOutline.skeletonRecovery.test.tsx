import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { EngineStructureWriterProvider } from '@/(pages)/(private)/sermons/[id]/components/EngineStructureWriterProvider';
import SermonOutline from '@/components/sermon/SermonOutline';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { useStructureWriter } from '@/components/sermon/structureWriter';
import { findDraftCopies } from '@/utils/durableDraft';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline as Outline } from '@/models/models';

const mockOwner = 'outline-recovery-owner';
let mockCurrent: Sermon;
const mockDocument = {
  get data() { return mockCurrent as unknown as DocumentData; },
  readOnly: false,
  update: jest.fn(async (updater: (value: DocumentData | null) => DocumentData | null) => {
    mockCurrent = updater(mockCurrent as unknown as DocumentData) as unknown as Sermon;
  }),
};
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataEngine: () => ({ owner: mockOwner }),
  useDataDocument: () => mockDocument,
  discoverLegacyRecovery: () => [],
}));
jest.mock('@/hooks/usePlanTemplates', () => ({ usePlanTemplates: () => ({ templates: [], createTemplate: jest.fn() }) }));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => undefined }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }),
}));
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: any }) => children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: any }) => children({ innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
}));
jest.mock('@/components/plan-editor/OutlineBoard', () => ({
  __esModule: true,
  default: ({ value }: { value: Outline }) => <div data-testid="recovery-outline">{value.introduction.map(point => point.text).join('|')}</div>,
}));

const opening = (): Sermon => ({
  id: 'outline-recovery-sermon', userId: mockOwner, title: 'Sermon', verse: '', date: '2026-11-01', thoughts: [],
  outline: { introduction: [{ id: 'p', text: 'First point' }], main: [{ id: 'q', text: 'Unrelated point' }], conclusion: [] },
});
const mount = (shown: Sermon) => render(<EngineStructureWriterProvider sermonId={shown.id}><SermonOutline sermon={shown} /></EngineStructureWriterProvider>);
async function refuseLocalPoint() {
  const shown = opening();mockCurrent = shown;
  const view = mount(shown);
  const point = screen.getByText('First point').closest('li')!;
  fireEvent.click(within(point).getByRole('button', { name: 'common.edit' }));
  const input = screen.getByDisplayValue('First point');
  fireEvent.change(input, { target: { value: 'Local retained point' } });
  mockCurrent = { ...mockCurrent, outline: { ...mockCurrent.outline!, introduction: [{ id: 'p', text: 'Saved different point' }] } };
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); });
  return view;
}

function RefusalProbe({ base }: { base: Outline }) {
  const writer = useStructureWriter();
  return <button type="button" onClick={() => {
    const mine = { ...base, introduction: [{ id: 'p', text: 'Local retained point' }] };
    void writer.updateSermonOutline('outline-recovery-sermon', mine, base, 'preferMine').catch(() => undefined);
  }}>deliver earlier refusal</button>;
}

describe('ordinary outline refusal recovery', () => {
  beforeEach(() => { localStorage.clear();jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks();localStorage.clear(); });

  it('retains the refused words and exposes comparison after the ordinary editor remounts', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await refuseLocalPoint();
    await waitFor(() => expect(findDraftCopies(mockOwner, mockCurrent.id, 'conflict:outlineConflict')).toHaveLength(1));
    expect(mockCurrent.outline!.introduction[0].text).toBe('Saved different point');
    expect(screen.getByRole('button', { name: 'freshness.reviewAction' })).toBeVisible();
    view.unmount();
    const reopened = mount(mockCurrent);
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'freshness.reviewAction' }));
      expect(await screen.findByTestId('recovery-outline')).toHaveTextContent('Local retained point');
      expect(screen.getByText('freshness.conflictTitle')).toBeVisible();
    } finally { reopened.unmount(); }
  });

  it('opens the same held refusal when durable draft storage is full', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota full', 'QuotaExceededError'); });
    const view = await refuseLocalPoint();
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'freshness.reviewAction' }));
      expect(await screen.findByTestId('recovery-outline')).toHaveTextContent('Local retained point');
      expect(mockCurrent.outline!.introduction[0].text).toBe('Saved different point');
    } finally { view.unmount(); }
  });
  it('keeps an already open editor on its own text until the new refused copy is explicitly reviewed', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = opening();
    mockCurrent = { ...base, outline: { ...base.outline!, introduction: [{ id: 'p', text: 'Saved different point' }] } };
    const view = render(<EngineStructureWriterProvider sermonId={base.id}>
      <RefusalProbe base={base.outline!} />
      <PlanEditorModal isOpen sermon={mockCurrent} onClose={() => undefined} />
    </EngineStructureWriterProvider>);
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'deliver earlier refusal' })); });
      await waitFor(() => expect(findDraftCopies(mockOwner, base.id, 'conflict:outlineConflict')).toHaveLength(1));
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await act(async () => { window.dispatchEvent(new StorageEvent('storage')); });
      expect(screen.getAllByText('freshness.conflictTitle')).toHaveLength(1);
      expect(screen.getByTestId('recovery-outline')).toHaveTextContent('Saved different point');
      expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'freshness.reviewAction' }));
      await waitFor(() => expect(screen.getByTestId('recovery-outline')).toHaveTextContent('Local retained point'));
      expect(screen.getByRole('button', { name: 'freshness.conflictKeepMine' })).toBeVisible();
    } finally { view.unmount(); }
  });

});
