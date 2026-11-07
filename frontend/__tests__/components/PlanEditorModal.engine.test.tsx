import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { draftKey, findDraftCopies, saveDraft } from '@/utils/durableDraft';
import '@testing-library/jest-dom';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline } from '@/models/models';

/**
 * THE FULL STRUCTURE EDITOR ON AN ENGINE DOCUMENT (owner, 2026-09-29).
 *
 * On engine documents the sermon page opened a separate, reduced editor: a narrow form without
 * templates, undo/redo, clear or the sermon title. The page now opens this editor on both kinds
 * of document; on the engine it writes through the same engine writer as the structure screen.
 */
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

const openEditor = (sermon: Sermon, isReadOnly = false) => render(
  <StructureWriterContext.Provider value={createEngineStructureWriter(fakeDocument, OWNER)}>
    <PlanEditorModal isOpen sermon={sermon} isReadOnly={isReadOnly} onClose={() => undefined} />
  </StructureWriterContext.Provider>
);

const flushSaveDebounce = async () => {
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
};

describe('the structure editor on an engine document', () => {
  it('keeps malformed retained outline words readable without applying the payload', () => {
    const server = { introduction: [], main: [{ id: 'p1', text: 'Server point' }], conclusion: [] };
    const broken = { introduction: [], main: [{ id: 'p1', text: 'Kept malformed outline words' }, null], conclusion: [] };
    const key = draftKey(OWNER, 's1', 'conflict:outlineConflict', 'invalid');
    const raw = JSON.stringify({ savedAt: 1, value: { payload: { outline: broken, serverOutline: server, baseOutline: server }, actualRevision: 0 } });
    localStorage.setItem(key, raw); documentCopy = sermonWith(server);
    let view: ReturnType<typeof openEditor> | undefined;
    try {
      view = openEditor(documentCopy);
      expect(screen.getByText('unsavedDraft.unreadableTitle')).toBeVisible();
      expect(screen.getAllByText(/Kept malformed outline words/)[0]).toBeVisible();
      expect(screen.getByTestId('board-text')).toHaveTextContent('Server point');
      expect(localStorage.getItem(key)).toBe(raw);
    } finally { view?.unmount(); }
  });

  it('keeps immediate edits to the current outline copy before selecting another copy', () => {
    const server = { introduction: [], main: [{ id: 'p1', text: 'Server point' }], conclusion: [] };
    const first = { introduction: [], main: [{ id: 'p1', text: 'First retained outline' }], conclusion: [] };
    const second = { introduction: [], main: [{ id: 'p1', text: 'Second retained outline' }], conclusion: [] };
    const key = draftKey(OWNER, 's1', 'conflict:outlineConflict', 'second');
    saveDraft(draftKey(OWNER, 's1', 'conflict:outlineConflict'), { payload: { outline: first, serverOutline: server, baseOutline: server }, actualRevision: 0 });
    saveDraft(key, { payload: { outline: second, serverOutline: server, baseOutline: server }, actualRevision: 0 });
    documentCopy = sermonWith(server);
    const view = openEditor(documentCopy);
    try {
      fireEvent.click(screen.getByText('edit-a-point'));
      expect(screen.getByTestId('board-text')).toHaveTextContent('edit 1');
      fireEvent.change(screen.getByRole('combobox', { name: 'unsavedDraft.chooseCopy' }), { target: { value: key } });
      expect(screen.getByTestId('board-text')).toHaveTextContent('Second retained outline');
      const copies = findDraftCopies<{ payload: { outline: SermonOutline } }>(OWNER, 's1', 'conflict:outlineConflict');
      expect(copies.map(copy => copy.value.payload.outline.main[0].text)).toEqual(expect.arrayContaining(['edit 1', 'Second retained outline']));
      expect(copies).toHaveLength(2);
    } finally { view.unmount(); }
  });

  it('loads the explicitly selected physical outline copy into the actual board', () => {
    const server = { introduction: [], main: [{ id: 'p1', text: 'Server point' }], conclusion: [] };
    const first = { introduction: [], main: [{ id: 'p1', text: 'First retained outline' }], conclusion: [] };
    const second = { introduction: [], main: [{ id: 'p1', text: 'Second retained outline' }], conclusion: [] };
    const key = draftKey(OWNER, 's1', 'conflict:outlineConflict', 'second');
    saveDraft(draftKey(OWNER, 's1', 'conflict:outlineConflict'), { payload: { outline: first, serverOutline: server, baseOutline: server }, actualRevision: 0 });
    saveDraft(key, { payload: { outline: second, serverOutline: server, baseOutline: server }, actualRevision: 0 });
    documentCopy = sermonWith(server);
    const view = openEditor(documentCopy);
    try {
      expect(screen.getByTestId('board-text')).toHaveTextContent('First retained outline');
      fireEvent.change(screen.getByRole('combobox', { name: 'unsavedDraft.chooseCopy' }), { target: { value: key } });
      expect(screen.getByTestId('board-text')).toHaveTextContent('Second retained outline');
    } finally { view.unmount(); }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    editCount = 0;
    jest.clearAllMocks();
  });
  afterEach(() => { jest.useRealTimers(); });

  it.each([
    { title: 'planEditor.clearConfirm.title', trigger: 'planEditor.clear', first: 'common.cancel', last: 'planEditor.clearConfirm.confirm' },
    { title: 'planEditor.apply.title', trigger: 'Three points', first: 'planEditor.apply.replace', last: 'common.cancel' },
    { title: 'planEditor.saveAs.title', trigger: 'planEditor.saveAsTemplate', first: null, last: 'planEditor.saveAs.save' },
  ])('keeps keyboard focus in $title and returns to the opening control', ({ title, trigger, first, last }) => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    const view = openEditor(documentCopy);
    const parent = screen.getByRole('dialog', { name: 'planEditor.title' });
    const inEditor = within(parent);
    const opensFromMenu = trigger !== 'planEditor.clear';
    const opener = inEditor.getByRole('button', { name: opensFromMenu ? 'planEditor.templates' : trigger });
    opener.focus();
    fireEvent.click(opener);
    if (opensFromMenu) {
      const choice = inEditor.getByRole('button', { name: new RegExp(trigger) });
      choice.focus();
      fireEvent.click(choice);
    }
    const question = screen.getByRole('heading', { name: title }).parentElement!;
    const inQuestion = within(question);
    const input = first ? null : inQuestion.getByRole('textbox');
    if (input) fireEvent.change(input, { target: { value: 'New template name' } });
    const firstControl = input ?? inQuestion.getByRole('button', { name: first! });
    const lastControl = inQuestion.getByRole('button', { name: last });
    firstControl.focus();
    fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();
    fireEvent.keyDown(lastControl, { key: 'Tab' });
    expect(firstControl).toHaveFocus();
    fireEvent.keyDown(firstControl, { key: 'Escape' });
    expect(question).not.toBeInTheDocument();
    expect(parent).toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(fakeDocument.update).not.toHaveBeenCalled();
    view.unmount();
  });

  it('leaves structure undo with the editor once its foreground question is dismissed', () => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    const view = openEditor(documentCopy);
    const editor = within(screen.getByRole('dialog', { name: 'planEditor.title' }));
    fireEvent.click(editor.getByText('edit-a-point'));
    expect(editor.getByTestId('board-text')).toHaveTextContent('edit 1');
    const writesBeforeQuestion = fakeDocument.update.mock.calls.length;
    const clear = editor.getByRole('button', { name: 'planEditor.clear' });
    clear.focus();
    fireEvent.click(clear);
    const question = within(screen.getByRole('dialog', { name: 'planEditor.clearConfirm.title' }));
    const cancel = question.getByRole('button', { name: 'common.cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'z', ctrlKey: true });
    expect(editor.getByTestId('board-text')).toHaveTextContent('edit 1');
    expect(fakeDocument.update).toHaveBeenCalledTimes(writesBeforeQuestion);
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(clear).toHaveFocus();
    fireEvent.keyDown(clear, { key: 'z', ctrlKey: true });
    expect(editor.getByTestId('board-text')).toHaveTextContent('Grace');
    view.unmount();
  });

  it('hands accepted board input to the engine before any departure can retire the screen', () => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    const view = openEditor(documentCopy);
    fireEvent.click(screen.getByText('edit-a-point'));
    // Observe ownership before unmount cleanup or a timer can rescue the input.
    const ownedBeforeDeparture = documentCopy.outline!.main[0].text;
    view.unmount();
    expect(ownedBeforeDeparture).toBe('edit 1');
  });

  it('hands the latest board continuation over while an earlier local persistence is still pending', async () => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    let release!: () => void;
    fakeDocument.update.mockImplementationOnce(async apply => {
      documentCopy = apply(documentCopy as unknown as DocumentData) as unknown as Sermon;
      await new Promise<void>(resolve => { release = resolve; });
    });
    const view = openEditor(documentCopy);
    try {
      fireEvent.click(screen.getByText('edit-a-point'));
      await flushSaveDebounce();
      fireEvent.click(screen.getByText('edit-a-point'));
      const ownedBeforeDeparture = documentCopy.outline!.main[0].text;
      view.unmount();
      expect(ownedBeforeDeparture).toBe('edit 2');
    } finally {
      await act(async () => { release?.(); await Promise.resolve(); });
    }
  });

  it('preserves an unseen phone point with the latest input while both local captures wait', async () => {
    const opened = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    documentCopy = sermonWith({ introduction: [], main: [
      { id: 'p1', text: 'Grace' }, { id: 'phone-point', text: 'Added on phone' },
    ], conclusion: [] });
    const ordinaryUpdate = fakeDocument.update.getMockImplementation()!;
    const releases: Array<() => void> = [];
    fakeDocument.update.mockImplementation(async apply => {
      documentCopy = apply(documentCopy as unknown as DocumentData) as unknown as Sermon;
      await new Promise<void>(resolve => { releases.push(resolve); });
    });
    const view = openEditor(opened);
    try {
      fireEvent.click(screen.getByText('edit-a-point'));
      fireEvent.click(screen.getByText('edit-a-point'));
      expect(releases).toHaveLength(2);
      expect(documentCopy.outline!.main.map(point => point.text)).toEqual(['edit 2', 'Added on phone']);
      await act(async () => { releases[0](); await Promise.resolve(); });
      // An older receipt cannot replace the latest input while its own capture is pending.
      expect(screen.getByTestId('board-text')).toHaveTextContent(/^edit 2$/);
      expect(documentCopy.outline!.main.map(point => point.text)).toEqual(['edit 2', 'Added on phone']);
      await act(async () => { releases[1](); await Promise.resolve(); });
      expect(screen.getByTestId('board-text')).toHaveTextContent('edit 2|Added on phone');
    } finally {
      await act(async () => { releases.forEach(resolve => resolve()); await Promise.resolve(); });
      fakeDocument.update.mockImplementation(ordinaryUpdate);
      view.unmount();
    }
  });

  it('writes an edit into the document through the engine writer', async () => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    openEditor(documentCopy);
    fireEvent.click(screen.getByText('edit-a-point'));
    await flushSaveDebounce();
    expect(documentCopy.outline!.main).toEqual([{ id: 'p1', text: 'edit 1' }]);
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

  it.each([false, true])('retains one title and each permitted header control when read-only is %s', isReadOnly => {
    documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
    openEditor(documentCopy, isReadOnly);
    expect(screen.getAllByRole('heading', { name: 'planEditor.title' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'common.close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'common.done' })).toHaveLength(1);
    for (const name of ['planEditor.undo', 'planEditor.redo', 'planEditor.templates', 'planEditor.clear']) {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(isReadOnly ? 0 : 1);
    }
  });

  describe('template menu visible area', () => {
    const originalWidth = window.innerWidth;
    const rect = (left: number, width: number): DOMRect => ({
      left, right: left + width, top: 68, bottom: 224, width, height: 156,
      x: left, y: 68, toJSON: () => ({}),
    });
    const setWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    const menuPanel = () => screen.getByRole('link', { name: 'planEditor.manageTemplates' }).parentElement!;
    const toggleMenu = () => fireEvent.click(screen.getByRole('button', { name: /planEditor\.templates/ }));
    beforeEach(() => {
      setWidth(390);
      jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(0);
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('role') === 'dialog' ? window.innerWidth - 32 : 0;
      });
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('role') === 'dialog') return rect(16, window.innerWidth - 32);
        if (!this.classList.contains('absolute') || !this.querySelector('a[href="/settings/templates"]')) return rect(0, 0);
        const anchorRight = window.innerWidth === 320 ? 163.8125 : window.innerWidth === 390 ? 170.1875 : 1048.1875;
        const width = Math.min(288, Number.parseFloat(this.style.maxWidth) || 288);
        const shift = Number.parseFloat(this.style.translate) || 0;
        return rect(anchorRight - width + shift, width);
      });
    });
    afterEach(() => { jest.restoreAllMocks(); setWidth(originalWidth); });
    const open = (width: number) => {
      setWidth(width);
      documentCopy = sermonWith({ introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] });
      openEditor(documentCopy);
      screen.getByRole('dialog', { name: 'planEditor.title' }).style.overflowX = 'hidden';
      toggleMenu(); return menuPanel();
    };
    const expectInsideDialog = (panel: HTMLElement) => {
      const menu = panel.getBoundingClientRect();
      const dialog = screen.getByRole('dialog', { name: 'planEditor.title' }).getBoundingClientRect();
      expect(menu.left).toBeGreaterThanOrEqual(dialog.left);
      expect(menu.right).toBeLessThanOrEqual(dialog.right);
    };
    it.each([390, 320])('keeps template names and actions inside the clipped dialog at %ipx', width => {
      const panel = open(width); expectInsideDialog(panel);
      expect(screen.getByRole('button', { name: /Three points/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'planEditor.saveAsTemplate' })).toBeEnabled();
    });
    it('keeps its existing wide-screen alignment and outside-click dismissal', () => {
      const panel = open(1280);
      expect(panel.getBoundingClientRect().left).toBe(760.1875);
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('link', { name: 'planEditor.manageTemplates' })).not.toBeInTheDocument();
      toggleMenu(); expectInsideDialog(menuPanel());
    });
    it('refits an open menu when the window becomes narrow', () => {
      const panel = open(1280); expectInsideDialog(panel);
      setWidth(320); fireEvent(window, new Event('resize')); expectInsideDialog(panel);
    });
  });

});
