import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import TemplateOutlineEditor from '@/components/settings/TemplateOutlineEditor';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'planTemplates', id: 'template-one' };
const createdAt = '2026-11-09T00:00:00.000Z';
const child = { id: 'child', text: 'Child opening', position: 4 };
const point = { id: 'point', text: 'Point opening', subPoints: [child] };
const neighbor = { id: 'neighbor', text: 'Independent text' };
const outline = { introduction: [], main: [point, neighbor], conclusion: [] };

beforeEach(() => localStorage.clear());

it.each([
  { target: 'point', choice: 'local' },
  { target: 'subpoint', choice: 'stored' },
])('holds both $target names and keeps the $choice choice after a refresh', async ({ target, choice }) => {
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'template-generation', revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: outline, createdAt, updatedAt: createdAt } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><TemplateOutlineEditor templateId={resource.id} disabled={false} /></DataEngineProvider>);
  try {
    const opening = target === 'point' ? point.text : child.text;
    fireEvent.doubleClick(await screen.findByText(opening));
    const input = screen.getByDisplayValue(opening);
    fireEvent.change(input, { target: { value: 'Local template title' } });
    const updated = target === 'point' ? { ...point, text: 'Saved template title' }
      : { ...point, subPoints: [{ ...child, text: 'Saved template title' }] };
    const stored = { ...outline, main: [updated, { ...neighbor, text: 'Independent saved edit' }] };
    await act(async () => h.remote({ structure: stored }));
    expect(screen.getByText('Independent saved edit')).toBeVisible();
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); await settleEngine(); });

    const comparison = await screen.findByRole('region', { name: /dataSync.versionComparison|Compare field versions/ });
    expect(within(comparison).getByText('Saved template title')).toBeVisible();
    expect(within(comparison).getByText('Local template title')).toBeVisible();
    expect(h.server.value?.structure).toEqual(stored);
    expect(h.transport.send).not.toHaveBeenCalled();

    // A later independent local title belongs to the owner whichever side wins the original comparison.
    fireEvent.doubleClick(screen.getByText('Independent saved edit'));
    const siblingInput = screen.getByDisplayValue('Independent saved edit');
    fireEvent.change(siblingInput, { target: { value: 'Independent local edit' } });
    await act(async () => { fireEvent.keyDown(siblingInput, { key: 'Enter' }); await settleEngine(); });
    await waitFor(() => expect(siblingInput).not.toBeInTheDocument());
    const pending = await h.checkpoints.listRecoverable('u1', resource);
    expect(pending.some(({ record }) => record.checkpoint.conflicts.some(({ mine, theirs }) =>
      mine.value === 'Local template title' && theirs.value === 'Saved template title'))).toBe(true);

    if (choice === 'local') {
      await act(async () => {
        fireEvent.click(within(comparison).getByRole('button', { name: /dataSync.useLocalVersion|Use my version/ }));
        await settleEngine();
      });
    } else {
      fireEvent.click(within(comparison).getByRole('button', { name: /dataSync.useStoredVersion|Use saved version/ }));
      const dialog = await screen.findByRole('dialog');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: /dataSync.confirmStoredField.confirm|Use saved version/ }));
        await settleEngine();
      });
    }
    const expectedTitle = choice === 'local' ? 'Local template title' : 'Saved template title';
    const expected = target === 'point' ? { ...updated, text: expectedTitle }
      : { ...updated, subPoints: [{ ...child, text: expectedTitle }] };
    await waitFor(() => expect(h.server.value?.structure).toEqual({
      ...stored, main: [expected, { ...neighbor, text: 'Independent local edit' }],
    }));
  } finally { view.unmount(); await act(settleEngine); }
});

it.each(['point', 'subpoint'])('keeps an unsubmitted template %s title accessible after the saved row is removed', async target => {
  const templateResource = { ...resource, id: `removal-${target}` };
  const h = documentEngineHarness({ resource: templateResource, metadata: { protocol: 1, generation: 'template-generation', revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: outline, createdAt, updatedAt: createdAt } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><TemplateOutlineEditor templateId={templateResource.id} disabled={false} /></DataEngineProvider>);
  try {
    const opening = target === 'point' ? point.text : child.text;
    fireEvent.doubleClick(await screen.findByText(opening));
    const draft = 'Words typed before the template row was removed';
    fireEvent.change(screen.getByDisplayValue(opening), { target: { value: draft } });
    expect(screen.getByDisplayValue(draft)).toBeVisible();

    const remaining = { ...neighbor, text: 'Neighbor saved with the deletion' };
    const stored = { ...outline, main: target === 'point' ? [remaining] : [{ ...point, subPoints: [] }, remaining] };
    await act(async () => h.remote({ structure: stored }));

    expect(await screen.findByText(remaining.text)).toBeVisible();
    expect(screen.queryByText(opening, { exact: true })).not.toBeInTheDocument();
    expect(h.server.value?.structure).toEqual(stored);
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(draft) ?? screen.queryByText(draft, { exact: true })).toBeVisible();
  } finally { view.unmount(); await act(settleEngine); }
});

it.each(['point', 'subpoint'])('lets a new offline %s be renamed before the server knows it', async target => {
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'template-generation', revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: outline, createdAt, updatedAt: createdAt } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><TemplateOutlineEditor templateId={resource.id} disabled={false} /></DataEngineProvider>);
  try {
    await screen.findByText(point.text);
    await act(async () => { h.engine.setOnline(false); await settleEngine(); });
    const add = target === 'point' ? screen.getAllByRole('button', { name: /structure.addPointButton|Add structure point/i })[1]
      : screen.getAllByRole('button', { name: /structure.addSubPoint|Add sub-point/i })[0];
    fireEvent.click(add);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'New offline row' } });
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); await settleEngine(); });

    fireEvent.doubleClick(await screen.findByText('New offline row'));
    const edit = screen.getByDisplayValue('New offline row');
    fireEvent.change(edit, { target: { value: 'Renamed before delivery' } });
    await act(async () => { fireEvent.keyDown(edit, { key: 'Enter' }); await settleEngine(); });
    expect(await screen.findByText('Renamed before delivery')).toBeVisible();
    expect(h.transport.send).not.toHaveBeenCalled();

    await act(async () => { h.engine.setOnline(true); await settleEngine(); });
    await waitFor(() => expect(JSON.stringify(h.server.value?.structure)).toContain('Renamed before delivery'));
  } finally { view.unmount(); await act(settleEngine); }
});

it('hands over the title before leaving even while another checkpoint is being written', async () => {
  const sibling = { id: 'neighbor-child', text: 'Independent child', position: 2 };
  const initial = { ...outline, main: [point, { ...neighbor, subPoints: [sibling] }] };
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'template-generation', revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: initial, createdAt, updatedAt: createdAt } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><TemplateOutlineEditor templateId={resource.id} disabled={false} /></DataEngineProvider>);
  let writing = false;
  const release = () => { h.storage.holdCompletionAfterCommit = undefined; h.storage.finishCompletion(); };
  try {
    fireEvent.doubleClick(await screen.findByText(point.text));
    const input = screen.getByDisplayValue(point.text);
    fireEvent.change(input, { target: { value: 'Title entered before leaving' } });
    fireEvent.doubleClick(screen.getByText(sibling.text));
    const other = screen.getByDisplayValue(sibling.text);
    fireEvent.change(other, { target: { value: 'Prior independent title' } });
    h.storage.holdCompletionAfterCommit = (rows, mode) => {
      if (writing || mode !== 'readwrite'
        || ![...rows.values()].some(record => JSON.stringify(record).includes('Prior independent title'))) return false;
      writing = true;
      return true;
    };
    fireEvent.keyDown(other, { key: 'Enter' });
    await waitFor(() => expect(writing).toBe(true));

    fireEvent.keyDown(input, { key: 'Enter' });
    view.rerender(<DataEngineProvider><div>Another screen</div></DataEngineProvider>);
    await act(async () => { release(); await settleEngine(); });

    await waitFor(() => expect(h.server.value?.structure).toEqual({
      ...initial, main: [{ ...point, text: 'Title entered before leaving' },
        { ...neighbor, subPoints: [{ ...sibling, text: 'Prior independent title' }] }],
    }));
  } finally { release(); view.unmount(); await act(settleEngine); }
});


function NewTemplate() {
  const [created, setCreated] = useState(false);
  const actions = useDocumentActions();
  return created ? <TemplateOutlineEditor templateId={resource.id} disabled={false} />
    : <button type="button" disabled={!actions.ready} onClick={() => {
      void actions.create(resource, { userId: 'u1', name: 'Created on this device',
        structure: { introduction: [], main: [], conclusion: [] }, createdAt, updatedAt: createdAt }).then(() => setCreated(true));
    }}>Create local template</button>;
}

it.each([false, true])('renames a point opened on a pending template creation (ACK before confirmation: %s)', async acknowledged => {
  const h = documentEngineHarness({ resource, metadata: null, value: null });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><NewTemplate /></DataEngineProvider>);
  try {
    const create = screen.getByRole('button', { name: 'Create local template' });
    await waitFor(() => expect(create).toBeEnabled());
    await act(async () => { h.engine.setOnline(false); await settleEngine(); });
    await act(async () => { fireEvent.click(create); await settleEngine(); });
    const add = (await screen.findAllByRole('button', { name: /structure.addPointButton|Add structure point/i }))[1];
    fireEvent.click(add);
    const adding = screen.getByRole('textbox');
    fireEvent.change(adding, { target: { value: 'First local point' } });
    await act(async () => { fireEvent.keyDown(adding, { key: 'Enter' }); await settleEngine(); });
    fireEvent.doubleClick(await screen.findByText('First local point'));
    const input = screen.getByDisplayValue('First local point');
    fireEvent.change(input, { target: { value: 'Title from the new template' } });
    if (acknowledged) {
      await act(async () => { h.engine.setOnline(true); await settleEngine(); });
      await waitFor(() => expect(h.server.metadata?.generation).toBeTruthy());
    } else {
      expect(h.server.value).toBeNull();
      expect(h.transport.send).not.toHaveBeenCalled();
    }
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); await settleEngine(); });
    expect(await screen.findByText('Title from the new template')).toBeVisible();
    await act(async () => { h.engine.setOnline(true); await settleEngine(); });
    await waitFor(() => expect(JSON.stringify(h.server.value?.structure)).toContain('Title from the new template'));
  } finally { view.unmount(); await act(settleEngine); }
});
