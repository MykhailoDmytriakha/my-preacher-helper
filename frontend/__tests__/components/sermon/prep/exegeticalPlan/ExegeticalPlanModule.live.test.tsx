import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useSyncExternalStore } from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ExegeticalPlanModule from '@/components/sermon/prep/exegeticalPlan/ExegeticalPlanModule';

import type { ExegeticalPlanNode } from '@/models/models';

/**
 * THE PLAN LIVES IN THE OPEN DOCUMENT (BUG-20261010-exegetical-plan-save-wipes-newer-words).
 *
 * The module used to keep its own copy of the plan, hand it to a save after a 15-second pause and,
 * when a save ended, replace the screen with the parent's copy — so words typed while a save was
 * on its way (offline: the whole time without a network) disappeared, a save of the author's intent
 * took back an unsaved plan edit, and leaving within the pause lost the edit. The owner's
 * construction (2026-10-11): every edit goes straight into the engine document, which saves it,
 * merges it with other devices and shows conflicts; the module only shows that document.
 *
 * The stand-in below behaves like the engine's open document: an edit changes the draft at once,
 * and the screen hears of it a moment later (after the device write).
 */
const ECHO_MS = 40;
type Edit = (nodes: ExegeticalPlanNode[]) => ExegeticalPlanNode[];

function openDocument(initial: ExegeticalPlanNode[]) {
  let draft = initial;
  let refusing = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    read: () => draft,
    titles: () => draft.map(node => node.title),
    edit: (edit: Edit): Promise<void> => {
      if (refusing) return Promise.reject(new Error('The sermon is not available for editing'));
      draft = edit(draft);
      setTimeout(notify, ECHO_MS);
      return Promise.resolve();
    },
    refuse: () => { refusing = true; },
    /** A change already in the draft that the screen has not been told about yet (stalled publication). */
    replaceQuietly: (next: ExegeticalPlanNode[]) => { draft = next; },
    /** What a save or another device brings: the draft is replaced and the screen hears at once. */
    replace: (next: ExegeticalPlanNode[]) => { draft = next; notify(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
type PlanDocument = ReturnType<typeof openDocument>;

/** The sermon page on the engine: the plan step reads the document and edits it. */
function Page({ doc, saving, onSave }: { doc: PlanDocument; saving: boolean; onSave: (nodes: ExegeticalPlanNode[]) => void }) {
  const value = useSyncExternalStore(doc.subscribe, doc.read);
  return <ExegeticalPlanModule value={value} onEdit={doc.edit} onSave={onSave} saving={saving} />;
}

const fields = () => screen.getAllByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder') as HTMLInputElement[];
const shown = () => fields().map(field => field.value);
const type = (field: HTMLInputElement, value: string) => fireEvent.change(field, { target: { value } });
const settle = () => act(async () => { jest.advanceTimersByTime(ECHO_MS * 3); });

describe('the exegetical plan on the engine document', () => {
  let doc: PlanDocument;
  let onSave: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    doc = openDocument([{ id: '1', title: 'First', children: [] }]);
    // A save of the old construction hands the plan to the document, as the page's save did.
    onSave = jest.fn((nodes: ExegeticalPlanNode[]) => doc.replace(nodes));
  });
  afterEach(() => jest.useRealTimers());

  it('keeps the words typed while a save was on its way when that save ends', async () => {
    const view = render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'First V1');
    await act(async () => { jest.advanceTimersByTime(15_100); });
    view.rerender(<Page doc={doc} saving onSave={onSave} />);
    type(fields()[0], 'First V1 V2');
    await settle();
    view.rerender(<Page doc={doc} saving={false} onSave={onSave} />);
    await settle();

    expect(shown()).toEqual(['First V1 V2']);
    expect(doc.titles()).toEqual(['First V1 V2']);
  });

  it("does not take back a plan edit when another field of the sermon (the author's intent) is saved", async () => {
    const view = render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'First edited');
    await settle();
    view.rerender(<Page doc={doc} saving onSave={onSave} />);
    view.rerender(<Page doc={doc} saving={false} onSave={onSave} />);
    await settle();

    expect(shown()).toEqual(['First edited']);
    expect(doc.titles()).toEqual(['First edited']);
  });

  it('puts an edit into the document at once, so leaving the page right away keeps it', async () => {
    const view = render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'First edited');
    view.unmount();

    expect(doc.titles()).toEqual(['First edited']);
  });

  it('shows a point added on another device and keeps it beside the words typed here', async () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'First mine');
    act(() => doc.replace([...doc.read(), { id: '2', title: 'From the phone', children: [] }]));
    await settle();

    expect(shown()).toEqual(['First mine', 'From the phone']);
    expect(doc.titles()).toEqual(['First mine', 'From the phone']);
  });

  it('keeps every letter of fast typing while the document echoes it late', async () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    const field = fields()[0];
    type(field, 'F');
    type(field, 'Fi');
    act(() => { jest.advanceTimersByTime(ECHO_MS); });
    type(field, 'Fir');
    expect(field).toHaveValue('Fir');
    await settle();

    expect(field).toHaveValue('Fir');
    expect(doc.titles()).toEqual(['Fir']);
  });

  it('keeps the words typed just before Enter adds the next point', async () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'Words');
    fireEvent.keyDown(fields()[0], { key: 'Enter' });
    await settle();

    expect(doc.titles()).toEqual(['Words', '']);
    expect(shown()).toEqual(['Words', '']);
  });

  it('starts an empty plan with one line to type into and writes it only once typed in', async () => {
    doc = openDocument([]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    expect(shown()).toEqual(['']);
    expect(doc.read()).toEqual([]);

    type(fields()[0], 'Opening point');
    await settle();
    expect(doc.titles()).toEqual(['Opening point']);
    expect(shown()).toEqual(['Opening point']);
  });

  it('needs no save button or autosave switch of its own', () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    expect(screen.queryByText('buttons.save')).not.toBeInTheDocument();
    expect(screen.queryByText('wizard.steps.exegeticalPlan.builder.autoSave')).not.toBeInTheDocument();
  });

  it('keeps refused words in view (they may be the only copy) and still shows the next document', async () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    doc.refuse();
    type(fields()[0], 'First refused');
    await settle();
    expect(shown()).toEqual(['First refused']);
    expect(doc.titles()).toEqual(['First']);

    act(() => doc.replace([{ id: '1', title: 'From the phone', children: [] }]));
    expect(shown()).toEqual(['From the phone']);
  });

  it('leaves the other points exactly as stored when one title changes', async () => {
    doc = openDocument([{ id: '1', title: 'First' }, { id: '2', title: 'Second' }]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'First edited');
    await settle();

    expect(doc.read()).toEqual([{ id: '1', title: 'First edited' }, { id: '2', title: 'Second' }]);
  });

  it('starts an emptied plan from a new line, never under the identity of the deleted point', async () => {
    doc = openDocument([]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    type(fields()[0], 'Only point');
    await settle();
    const deletedId = doc.read()[0].id;

    fireEvent.click(screen.getByLabelText('wizard.steps.exegeticalPlan.builder.tooltips.delete'));
    await settle();
    expect(doc.read()).toEqual([]);
    type(fields()[0], 'Next point');
    await settle();

    expect(doc.titles()).toEqual(['Next point']);
    expect(doc.read()[0].id).not.toBe(deletedId);
  });

  it('brings back a point deleted on another device, with the words typed into it while it was still on screen', async () => {
    doc = openDocument([{ id: '1', title: 'First', children: [] }, { id: '2', title: 'Second', children: [] }]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    doc.replaceQuietly([{ id: '2', title: 'Second', children: [] }]);
    type(fields()[0], 'First and more');
    await settle();

    expect(doc.read()).toEqual([{ id: '1', title: 'First and more', children: [] }, { id: '2', title: 'Second', children: [] }]);
    expect(shown()).toEqual(['First and more', 'Second']);
  });

  it('adds no empty point when an action meets a point that is already gone from the plan', async () => {
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    doc.replaceQuietly([]);
    fireEvent.keyDown(fields()[0], { key: 'Enter' });
    await settle();
    expect(doc.read()).toEqual([]);
  });

  it('demotes a point under the point the person saw above it, even if the plan was reordered meanwhile', async () => {
    doc = openDocument([
      { id: 'a', title: 'A', children: [] }, { id: 'x', title: 'X', children: [] }, { id: 'b', title: 'B', children: [] },
    ]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    doc.replaceQuietly([
      { id: 'a', title: 'A', children: [] }, { id: 'b', title: 'B', children: [] }, { id: 'x', title: 'X', children: [] },
    ]);
    fireEvent.click(screen.getAllByLabelText('wizard.steps.exegeticalPlan.builder.tooltips.demote')[1]);
    await settle();

    expect(doc.read()).toEqual([
      { id: 'a', title: 'A', children: [{ id: 'x', title: 'X', children: [] }] }, { id: 'b', title: 'B', children: [] },
    ]);
  });

  it('does not promote a point that was moved under another parent before the screen showed it', async () => {
    doc = openDocument([
      { id: 'p', title: 'P', children: [{ id: 'x', title: 'X', children: [] }] }, { id: 'q', title: 'Q', children: [] },
    ]);
    render(<Page doc={doc} saving={false} onSave={onSave} />);
    const moved = [{ id: 'p', title: 'P', children: [] }, { id: 'q', title: 'Q', children: [{ id: 'x', title: 'X', children: [] }] }];
    doc.replaceQuietly(moved);
    fireEvent.click(screen.getAllByLabelText('wizard.steps.exegeticalPlan.builder.tooltips.promote')[1]);
    await settle();

    expect(doc.read()).toEqual(moved);
  });
});
