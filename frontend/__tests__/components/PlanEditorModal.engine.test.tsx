import { act, fireEvent, render, screen } from '@testing-library/react';

import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { updateSermonOutline } from '@/services/outline.service';
import '@testing-library/jest-dom';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline } from '@/models/models';

/**
 * THE FULL STRUCTURE EDITOR ON AN ENGINE DOCUMENT (owner, 2026-09-29).
 *
 * On engine documents the sermon page opened a separate, reduced editor: a narrow form without
 * templates, undo/redo, clear or the sermon title. The page now opens this editor on both kinds
 * of document; on the engine it writes through the same engine writer as the structure screen.
 * The legacy service refuses here, as it does in production, so a write that slips past the
 * writer in context fails the test instead of passing silently.
 */
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(async () => { throw new Error('data-engine-required'); }),
}));
const mockTemplates = [{ id: 'tpl', userId: 'u1', name: 'Three points', structure: {
  introduction: [{ id: 't-i', text: 'Opening' }], main: [{ id: 't-m', text: 'Body' }], conclusion: [],
} }];
jest.mock('@/hooks/usePlanTemplates', () => ({
  usePlanTemplates: () => ({ templates: mockTemplates, createTemplate: jest.fn() }),
}));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => undefined }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let editCount = 0;
jest.mock('@/components/plan-editor/OutlineBoard', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: SermonOutline; onChange: (next: SermonOutline) => void }) => (
    <div>
      <span data-testid="board-text">{[...value.introduction, ...value.main].map(point => point.text).join('|')}</span>
      <button type="button" onClick={() => {
        editCount += 1;
        onChange({ introduction: value.introduction, main: [{ id: 'p1', text: `edit ${editCount}` }], conclusion: [] });
      }}>edit-a-point</button>
    </div>
  ),
}));

const OWNER = 'u1';
let documentCopy: Sermon;
const fakeDocument = {
  update: jest.fn(async (fn: (current: DocumentData | null) => DocumentData | null) => {
    documentCopy = fn(documentCopy as unknown as DocumentData) as unknown as Sermon;
  }),
};

const sermonWith = (outline: SermonOutline): Sermon => ({
  id: 's1', userId: OWNER, title: 'Sermon', verse: '', date: '2026-09-29', thoughts: [], outline,
} as unknown as Sermon);

const openEditor = (sermon: Sermon) => render(
  <StructureWriterContext.Provider value={createEngineStructureWriter(fakeDocument, OWNER)}>
    <PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />
  </StructureWriterContext.Provider>
);

const flushSaveDebounce = async () => {
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
};

describe('the structure editor on an engine document', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    editCount = 0;
    jest.clearAllMocks();
  });
  afterEach(() => { jest.useRealTimers(); });

  it('writes an edit into the document through the engine writer', async () => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    openEditor(documentCopy);
    fireEvent.click(screen.getByText('edit-a-point'));
    await flushSaveDebounce();
    expect(documentCopy.outline!.main).toEqual([{ id: 'p1', text: 'edit 1' }]);
    expect(updateSermonOutline).not.toHaveBeenCalled();
  });

  it('applies a template into the document', async () => {
    documentCopy = sermonWith({ introduction: [], main: [], conclusion: [] });
    openEditor(documentCopy);
    fireEvent.click(screen.getByRole('button', { name: /planEditor\.templates/ }));
    fireEvent.click(screen.getByRole('button', { name: /Three points/ }));
    await flushSaveDebounce();
    expect(documentCopy.outline!.introduction.map(point => point.text)).toEqual(['Opening']);
    expect(documentCopy.outline!.main.map(point => point.text)).toEqual(['Body']);
    expect(screen.getByTestId('board-text')).toHaveTextContent('Opening|Body');
  });

  it('turns the same point changed elsewhere into the keep-mine / take-theirs choice', async () => {
    const opened = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Mercy' }], conclusion: [] });
    openEditor(opened);
    fireEvent.click(screen.getByText('edit-a-point'));
    await flushSaveDebounce();
    expect(documentCopy.outline!.main).toEqual([{ id: 'p1', text: 'Mercy' }]);
    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
  });
});
