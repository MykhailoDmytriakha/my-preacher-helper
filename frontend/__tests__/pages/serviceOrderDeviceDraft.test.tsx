import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import ServiceOrdersPage from '@/(pages)/(private)/care/orders/page';
import ServiceOrderPage from '@/(pages)/(private)/care/orders/[id]/page';
import { actionClock } from '@/data-engine/actionClock.client';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { ACTION_SLOT, isDocumentEditorSlot } from '@/data-engine/editorIdentity';
import { DataEngineProvider } from '@/data-engine/react.client';
import { applyCommand } from '@/data-engine/protocol';
import { DataSession } from '@/data-engine/session';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { findDraftCopies, isDraftStorageRefusedFor } from '@/utils/durableDraft';
import { editHistoryShown } from '@/utils/editHistory';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner' }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/utils/editHistory', () => ({ editHistoryShown: jest.fn(() => false) }));
jest.mock('@/services/ownerHttpTransport.client', () => ({
  ...jest.requireActual('@/services/ownerHttpTransport.client'),
  requestOwnerJson: jest.fn(jest.requireActual('@/services/ownerHttpTransport.client').requestOwnerJson),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order-1' }), useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/care/orders/order-1', useSearchParams: () => new URLSearchParams(),
}));

const resource = { collection: 'serviceOrders', id: 'order-1' };
const initial: ResourceSnapshot = {
  resource,
  metadata: { protocol: 1, generation: 'order-generation', revision: 5, deleted: false },
  value: { userId: 'owner', title: 'Evening service', rank: 1000, createdAt: '2026-11-23T03:00:00.000Z', updatedAt: '2026-11-23T03:00:00.000Z',
    steps: [{ id: 'step-1', title: 'Opening prayer', body: 'The original paragraph.', scriptureRefs: ['John 1:1'] }] },
};

it('keeps editing open across renders and delivers only the final values after a pause', async () => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  expect(screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' })).not.toBeDisabled();

  jest.useFakeTimers();
  try {
    const type = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
    fireEvent.focus(screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' }));
    type('serviceOrders.orderTitle', 'Sunday');
    type('serviceOrders.orderTitle', 'Sunday evening service');
    type('serviceOrders.stepWords', 'The original paragraph. New');
    type('serviceOrders.stepWords', 'The original paragraph. New final words.');
    await act(settleEngine);
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect(harness.server).toEqual(initial);

    await act(async () => { jest.advanceTimersByTime(699); await settleEngine(); });
    expect(harness.transport.send).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(1); await settleEngine(); });
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(harness.transport.send).toHaveBeenCalledTimes(2);
    expect(harness.server.value).toMatchObject({
      title: 'Sunday evening service',
      steps: [{ id: 'step-1', title: 'Opening prayer', body: 'The original paragraph. New final words.', scriptureRefs: ['John 1:1'] }],
    });
    const [title, body] = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
    expect(title).toMatchObject({
      serviceOrderTitleAction: { before: 'Evening service', after: 'Sunday evening service', observedRevision: 5 },
    });
    expect(body).toMatchObject({ serviceOrderStepBodyActions: [{ rowId: 'step-1', observedRevision: 5 }] });
    await act(async () => { await harness.engine.retry(resource); await settleEngine(); });
    const copies = await harness.checkpoints.listRecoverable('owner', resource);
    expect(copies.filter(({ record }) => record.editorId.includes('"service-order-input"'))).toEqual([]);
  } finally {
    view.unmount();
    await act(settleEngine);
    jest.useRealTimers();
  }
});

it('already has the title, step text and references on this device before the pause or any leave event', async () => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  expect(screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' })).not.toBeDisabled();

  jest.useFakeTimers();
  const start = { earliestMs: 1795431000000, latestMs: 1795431000001 };
  const last = { earliestMs: 1795431000010, latestMs: 1795431000011 };
  const time = jest.spyOn(actionClock, 'capture').mockReturnValue(start);
  try {
    const type = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
    type('serviceOrders.orderTitle', 'Sunday evening service');
    type('serviceOrders.stepTitle', 'Welcome and prayer');
    type('serviceOrders.stepWords', 'The original paragraph. New');
    time.mockReturnValue(last);
    type('serviceOrders.stepWords', 'The original paragraph. New final words.');
    type('serviceOrders.refs', 'John 1:1, John 1:2');
    await act(settleEngine);

    // A process can disappear without the page's blur, visibility or cleanup handlers.
    const copies = await harness.checkpoints.listRecoverable('owner', resource);
    expect(Object.values(copies[0]?.record.checkpoint.serviceOrderInputs ?? {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'orderTitle', before: 'Evening service',
        version: { generation: 'order-generation', observedRevision: 5 } }),
      expect.objectContaining({ field: 'body', stepId: 'step-1', before: 'The original paragraph.', time: last,
        version: { generation: 'order-generation', observedRevision: 5 } }),
      expect.objectContaining({ field: 'scriptureRefs', stepId: 'step-1', before: ['John 1:1'], raw: 'John 1:1, John 1:2' }),
    ]));
    expect(copies.map(({ record }) => record.checkpoint.draft)).toContainEqual(expect.objectContaining({
      title: 'Sunday evening service',
      steps: [{ id: 'step-1', title: 'Welcome and prayer', body: 'The original paragraph. New final words.', scriptureRefs: ['John 1:1', 'John 1:2'] }],
    }));
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect(harness.server).toEqual(initial);
  } finally {
    time.mockRestore();
    view.unmount();
    await act(settleEngine);
    jest.useRealTimers();
  }
});

it('retains an unverified opening without assigning the engine’s newer revision to it', () => {
  const session = new DataSession(initial);
  session.edit({ ...initial.value, title: 'Latest local words' }, undefined, {
    field: 'service-order-input', input: { field: 'orderTitle', before: 'A title still shown from earlier',
      value: 'Latest local words', time: null },
  });
  const [input] = Object.values(session.checkpoint().serviceOrderInputs ?? {});
  expect(input).toMatchObject({ before: 'A title still shown from earlier', value: 'Latest local words' });
  expect(input?.version).toBeUndefined();
});

it('does not assign a newer revision to an unverified opening even when its text matches', () => {
  const session = new DataSession(initial);
  session.edit({ ...initial.value, title: 'Latest local words' }, undefined, {
    field: 'service-order-input', input: { field: 'orderTitle', before: 'Evening service',
      value: 'Latest local words', time: null },
  });
  const [input] = Object.values(session.checkpoint().serviceOrderInputs ?? {});
  expect(input).toMatchObject({ before: 'Evening service', value: 'Latest local words' });
  expect(input?.version).toBeUndefined();
});

it('resumes a closed editor and saves only the selected service field with its original action evidence', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const previous = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const orderTitle = { field: 'orderTitle', before: 'Evening service', value: 'A private name', time: null } as const;
  const body = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'Words after reopening.',
    version: { generation: 'order-generation', observedRevision: 5 },
    time: { earliestMs: 1795431000000, latestMs: 1795431000001 } } as const;
  const confirmed = previous.getState().checkpoint.confirmed.value!;
  await previous.edit({ ...confirmed, title: orderTitle.value }, undefined, { field: 'service-order-input', input: orderTitle });
  await previous.edit({ ...confirmed, title: orderTitle.value,
    steps: [{ id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] }],
  }, undefined, { field: 'service-order-input', input: body });
  previous.close();
  await settleEngine();
  const [source] = await browser.engine.listRecoveryChoices(resource);
  expect(source.record.checkpoint.serviceOrderInputs).toBeDefined();
  const restored = await browser.engine.recoverEditor(resource, browser.editorId(resource, 'service-order-input'), source.id, { autoSaveOnResume: false });
  expect(harness.transport.send).not.toHaveBeenCalled();

  await restored.saveServiceOrderInput(body);
  await browser.engine.retry(resource);

  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.transport.send).toHaveBeenCalledWith(expect.objectContaining({
    serviceOrderStepBodyActions: [
      expect.objectContaining({ rowId: body.stepId, observedRevision: body.version.observedRevision, time: body.time }),
    ],
    changes: [{ path: ['steps'],
      before: { exists: true, value: [expect.objectContaining({ id: body.stepId, body: body.before })] },
      after: { exists: true, value: [expect.objectContaining({ id: body.stepId, body: body.value })] } }],
  }));
  expect(harness.server.value).toMatchObject({ title: orderTitle.before,
    steps: [{ id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] }] });
  expect(restored.getState().checkpoint.draft).toMatchObject({ title: orderTitle.value });
  expect(Object.values(restored.getState().checkpoint.serviceOrderInputs ?? {})).toEqual([orderTitle]);
  restored.close();
  browser.dispose();
});

it('keeps an unverified draft for comparison if the saved words changed, and allows another field to be recovered', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const previous = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const body = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'My recovered words.', time: null } as const;
  const title = { field: 'orderTitle', before: 'Evening service', value: 'My recovered title', time: null } as const;
  await previous.edit({ ...initial.value, title: title.value }, undefined, { field: 'service-order-input', input: title });
  await previous.edit({ ...initial.value, title: title.value,
    steps: [{ id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] }],
  }, undefined, { field: 'service-order-input', input: body });
  previous.close();
  await settleEngine();
  const [source] = await browser.engine.listRecoveryChoices(resource);
  await harness.remote({ steps: [{ id: body.stepId, title: 'Opening prayer', body: 'Updated on the phone.', scriptureRefs: ['John 1:1'] }] });
  const restored = await browser.engine.recoverEditor(resource, browser.editorId(resource, 'service-order-input'), source.id, { autoSaveOnResume: false });
  await act(settleEngine);

  await expect(restored.saveServiceOrderInput(body)).rejects.toMatchObject({ code: 'resolve-version-first' });
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(Object.values(restored.getState().checkpoint.serviceOrderInputs ?? {})).toContainEqual(body);

  await restored.saveServiceOrderInput(title);
  await browser.engine.retry(resource);
  expect(harness.server.value).toMatchObject({ title: title.value,
    steps: [{ id: body.stepId, body: 'Updated on the phone.', title: 'Opening prayer', scriptureRefs: ['John 1:1'] }],
  });
  expect(Object.values(restored.getState().checkpoint.serviceOrderInputs ?? {})).toContainEqual(body);
  restored.close();
  browser.dispose();
});

it('shows a closed device draft on the service page and sends only the field the person applies', async () => {
  const harness = documentEngineHarness(initial);
  const previousBrowser = harness.createBrowser();
  previousBrowser.engine.setOwner('owner');
  const oldEditor = await previousBrowser.engine.openEditor(resource, previousBrowser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const body = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'Unsent words from this device.',
    version: { generation: 'order-generation', observedRevision: 5 }, time: null } as const;
  await oldEditor.edit({ ...initial.value, steps: [{ id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] }] },
    undefined, { field: 'service-order-input', input: body });
  oldEditor.close();
  await settleEngine();
  previousBrowser.dispose();

  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(await screen.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
  const review = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
  expect(review.getByText(body.value)).toBeInTheDocument();
  expect(review.getByText(body.before)).toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.applyRecoveredField' }));
  await waitFor(() => expect(harness.server.value?.steps).toEqual([
    { id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] },
  ]));
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'dataSync.reviewSavedChange' })).not.toBeInTheDocument());
  view.unmount();
  await act(settleEngine);
});

it('keeps a synchronous service input copy until the exact IndexedDB checkpoint lands', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const input = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'Last complete words before the crash.',
    version: { generation: 'order-generation', observedRevision: 5 },
    time: { earliestMs: 1795431000000, latestMs: 1795431000001 } } as const;
  const writing = editor.edit({ ...initial.value,
    steps: [{ id: input.stepId, title: 'Opening prayer', body: input.value, scriptureRefs: ['John 1:1'] }],
  }, undefined, { field: 'service-order-input', input });
  const reserved = findDraftCopies<{ input: unknown }>('owner', resource.id, 'service-order-input');
  expect(reserved.map(({ value }) => value.input)).toEqual([input]);
  expect(harness.storage.counts.puts).toBe(0);
  expect(harness.transport.send).not.toHaveBeenCalled();

  await writing;
  expect(findDraftCopies('owner', resource.id, 'service-order-input')).toEqual([]);
  expect(Object.values(editor.getState().checkpoint.serviceOrderInputs ?? {})).toEqual([input]);
  editor.close();
  browser.dispose();
});

it('imports the newest reserve after IndexedDB refuses the input and a fresh editor opens', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser({ recoveryPresence: { held: async () => false, hold: () => () => undefined } });
  browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const edit = (value: string) => editor.edit({ ...initial.value,
    steps: [{ id: 'step-1', title: 'Opening prayer', body: value, scriptureRefs: ['John 1:1'] }],
  }, undefined, { field: 'service-order-input', input: { field: 'body', stepId: 'step-1',
    before: 'The original paragraph.', value, time: null, version: { generation: 'order-generation', observedRevision: 5 } } });
  harness.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint';
  await expect(edit('Earlier words')).rejects.toThrow();
  await expect(edit('Latest reserved words')).rejects.toThrow();
  const [reserve] = findDraftCopies('owner', resource.id, 'service-order-input');
  expect(reserve).toBeDefined();
  expect(findDraftCopies('someone-else', resource.id, 'service-order-input')).toEqual([]);
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(await browser.engine.listRecoveryChoices(resource)).toEqual([]);
  editor.dispose();
  await settleEngine();

  harness.storage.writeFailureFor = undefined;
  const [found] = await browser.engine.listRecoveryChoices(resource);
  expect(isDocumentEditorSlot(found.record.editorId, resource, 'service-order-input')).toBe(true);
  expect(found.record.checkpoint.draft?.steps).toEqual([
    { id: 'step-1', title: 'Opening prayer', body: 'Latest reserved words', scriptureRefs: ['John 1:1'] },
  ]);
  expect(findDraftCopies('owner', resource.id, 'service-order-input')).toEqual([]);
  expect(await browser.engine.listRecoveryChoices(resource)).toHaveLength(1);
  const restored = await browser.engine.recoverEditor(resource, browser.editorId(resource, 'service-order-input'), found.id, { autoSaveOnResume: false });
  expect(restored.getState().checkpoint.serviceOrderInputs).toEqual(found.record.checkpoint.serviceOrderInputs);
  expect(harness.transport.send).not.toHaveBeenCalled();
  restored.close();
  browser.dispose();
});

it('replaces only the older bytes for the same field in a closed native checkpoint', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser({ recoveryPresence: { held: async () => false, hold: () => () => undefined } });
  browser.engine.setOwner('owner');
  const editorId = browser.editorId(resource, 'service-order-input');
  const editor = await browser.engine.openEditor(resource, editorId, { autoSaveOnResume: false });
  const title = { field: 'orderTitle', before: 'Evening service', value: 'A different private field', time: null } as const;
  const start = { ...initial.value, title: title.value };
  await editor.edit(start, undefined, { field: 'service-order-input', input: title });
  const body = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'First body',
    version: { generation: 'order-generation', observedRevision: 5 }, time: null } as const;
  const put = (value: string) => editor.edit({ ...start, steps: [
    { id: body.stepId, title: 'Opening prayer', body: value, scriptureRefs: ['John 1:1'] },
  ] }, undefined, { field: 'service-order-input', input: { ...body, value } });
  await put(body.value);
  harness.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint';
  await expect(put('Newer body')).rejects.toThrow();
  editor.dispose();
  await settleEngine();
  harness.storage.writeFailureFor = undefined;
  const choices = await browser.engine.listRecoveryChoices(resource);
  expect(choices).toHaveLength(1);
  expect(choices[0].record.editorId).toBe(editorId);
  expect(Object.values(choices[0].record.checkpoint.serviceOrderInputs ?? {})).toEqual([
    title, { ...body, value: 'Newer body' },
  ]);
  expect(choices[0].record.checkpoint.draft?.title).toBe(title.value);
  expect(findDraftCopies('owner', resource.id, 'service-order-input')).toEqual([]);
  expect(harness.transport.send).not.toHaveBeenCalled();
  browser.dispose();
});

it.each(['local', 'stored', 'stale', 'returned-stored', 'returned-local'] as const)('handles a %s choice of a service field without touching a private sibling', async side => {
  const harness = documentEngineHarness(initial);
  const previous = harness.createBrowser();
  previous.engine.setOwner('owner');
  const old = await previous.engine.openEditor(resource, previous.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const returned = side.startsWith('returned');
  const useLocal = side === 'local' || side === 'returned-local';
  const body = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'My private words.', time: null,
    ...(returned && { version: { generation: 'order-generation', observedRevision: 5 } }) } as const;
  const title = { field: 'orderTitle', before: 'Evening service', value: 'My private title', time: null } as const;
  const draft = { ...initial.value, title: title.value };
  await old.edit(draft, undefined, { field: 'service-order-input', input: title });
  await old.edit({ ...draft, steps: [{ id: body.stepId, title: 'Opening prayer', body: body.value, scriptureRefs: ['John 1:1'] }] },
    undefined, { field: 'service-order-input', input: body });
  old.close();
  await settleEngine();
  previous.dispose();
  const phone = 'The other device’s paragraph.';
  harness.silentRemote({ steps: [{ id: body.stepId, title: 'Opening prayer', body: phone, scriptureRefs: ['John 1:1'] }] });

  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
  const review = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
  expect(review.getByText(body.value)).toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled();
  if (returned) fireEvent.click(review.getAllByRole('button', { name: 'serviceOrders.applyRecoveredField' }).at(-1)!);
  await review.findByText(phone);
  const latest = 'An unseen third revision.';
  if (side === 'stale') harness.silentRemote({ steps: [{ id: body.stepId, title: 'Opening prayer', body: latest, scriptureRefs: ['John 1:1'] }] });
  fireEvent.click(await review.findByRole('button', { name: useLocal || side === 'stale' ? 'dataSync.useLocalVersion' : 'dataSync.useStoredVersion' }));

  if (side === 'stale') {
    await review.findByText(latest);
    expect(review.getByText(body.value)).toBeInTheDocument();
  } else await waitFor(() => expect(review.queryByText(body.value)).not.toBeInTheDocument());
  expect(review.getByText(title.value)).toBeInTheDocument();
  expect(harness.transport.send).toHaveBeenCalledTimes(Number(returned) + Number(useLocal));
  expect(harness.server.value).toMatchObject({ title: title.before, steps: [{ id: body.stepId,
    body: useLocal ? body.value : side === 'stale' ? latest : phone, scriptureRefs: ['John 1:1'] }] });
  await act(async () => { await harness.engine.retry(resource); await settleEngine(); });
  view.unmount();
  await act(settleEngine);
  const reopened = harness.createBrowser();
  reopened.engine.setOwner('owner');
  const choices = await reopened.engine.listRecoveryChoices(resource);
  const remaining = choices.flatMap(({ record }) => Object.values(record.checkpoint.serviceOrderInputs ?? {}));
  expect(remaining).toEqual(side === 'stale' ? [title, body] : [title]);
  reopened.dispose();
});

it.each(['step', 'service'] as const)('shows the retained words after another device removed the %s without restoring it', async removed => {
  const harness = documentEngineHarness(initial);
  const previous = harness.createBrowser({ recoveryPresence: { held: async () => false, hold: () => () => undefined } });
  previous.engine.setOwner('owner');
  const old = await previous.engine.openEditor(resource, previous.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const input = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'Words from the removed step.',
    time: null, version: { generation: 'order-generation', observedRevision: 5 } } as const;
  const writing = () => old.edit({ ...initial.value, steps: [
    { id: input.stepId, title: 'Opening prayer', body: input.value, scriptureRefs: ['John 1:1'] },
  ] }, undefined, { field: 'service-order-input', input });
  if (removed === 'service') {
    harness.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint';
    await expect(writing()).rejects.toThrow();
    old.dispose();
    await settleEngine();
    harness.storage.writeFailureFor = undefined;
    harness.silentRemoteDelete();
  } else {
    await writing();
    old.close();
    await settleEngine();
    expect(harness.transport.send).not.toHaveBeenCalled();
    harness.silentRemote({ steps: [] });
  }
  previous.dispose();
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true,
    recoveryPresence: { held: async () => false, hold: () => () => undefined } }));
  if (removed === 'service') {
    const library = render(<DataEngineProvider><ServiceOrdersPage /></DataEngineProvider>);
    const link = await screen.findByRole('link', { name: 'Evening service' });
    expect(link).toHaveAttribute('href', '/care/orders/order-1');
    library.unmount();
    await act(settleEngine);
  }
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
  const review = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
  await review.findByText('serviceOrders.recoveredFieldUnavailable');
  expect(review.getByText(input.value)).toBeInTheDocument();
  expect(review.queryByRole('button', { name: 'serviceOrders.applyRecoveredField' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(Number(removed === 'service'));
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(removed === 'service' ? harness.server.value : harness.server.value?.steps).toEqual(removed === 'service' ? null : []);
  view.unmount();
  await act(settleEngine);
});

it('keeps the last words in session when both stores refuse and retries the reserve on pagehide', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const input = { field: 'body', stepId: 'step-1', before: 'The original paragraph.', value: 'These words still need a device copy.',
    time: null, version: { generation: 'order-generation', observedRevision: 5 } } as const;
  harness.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint';
  const nativeSet = Storage.prototype.setItem;
  let refused = true;
  const localWrite = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (refused && key.includes(':service-order-input:')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
    return nativeSet.call(this, key, value);
  });
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await expect(editor.edit({ ...initial.value, steps: [
      { id: input.stepId, title: 'Opening prayer', body: input.value, scriptureRefs: ['John 1:1'] },
    ] }, undefined, { field: 'service-order-input', input })).rejects.toThrow();
    expect(isDraftStorageRefusedFor('owner')).toBe(true);
    expect(Object.values(editor.getState().checkpoint.serviceOrderInputs ?? {})).toEqual([input]);
    expect(findDraftCopies('owner', resource.id, 'service-order-input')).toEqual([]);
    refused = false;
    window.dispatchEvent(new Event('pagehide'));
    expect(findDraftCopies<{ input: unknown }>('owner', resource.id, 'service-order-input').map(({ value }) => value.input)).toEqual([input]);
    expect(isDraftStorageRefusedFor('owner')).toBe(false);
    expect(harness.transport.send).not.toHaveBeenCalled();
    harness.storage.writeFailureFor = undefined;
    await browser.engine.retry(resource);
    expect(findDraftCopies('owner', resource.id, 'service-order-input')).toEqual([]);
  } finally {
    editor.close();
    browser.dispose();
    await settleEngine();
    localWrite.mockRestore();
    log.mockRestore();
  }
});

it.each(['pause', 'close', 'offline-undo'] as const)('owns service field delivery in the engine on %s', async trigger => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const opening = 'The original paragraph.';
  const time = (offset: number) => ({ earliestMs: 1795431000000 + offset, latestMs: 1795431000001 + offset });
  const stage = (before: string, value: string, offset: number) => editor.stageServiceOrderInput({ ...initial.value,
    steps: [{ id: 'step-1', title: 'Opening prayer', body: value, scriptureRefs: ['John 1:1'] }],
  }, undefined, { field: 'body', stepId: 'step-1', before, value, time: time(offset), version: { generation: 'order-generation', observedRevision: 5 } });
  jest.useFakeTimers();
  try {
    if (trigger === 'offline-undo') browser.engine.setOnline(false);
    await stage(opening, 'My working text', 10);
    await stage('My working text', 'My final text', 20);
    jest.advanceTimersByTime(699);
    expect(harness.transport.send).not.toHaveBeenCalled();
    if (trigger === 'close') editor.close();
    else jest.advanceTimersByTime(1);
    await settleEngine();
    if (trigger === 'offline-undo') {
      expect(harness.transport.send).not.toHaveBeenCalled();
      const waiting = await harness.commits.list('owner');
      expect(waiting).toHaveLength(1);
      await stage('My final text', opening, 30);
      jest.advanceTimersByTime(700);
      await settleEngine();
      browser.engine.setOnline(true);
    }
    await browser.engine.retry(resource);
    const sent = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
    expect(sent).toHaveLength(trigger === 'offline-undo' ? 2 : 1);
    expect(sent[0]).toMatchObject({ serviceOrderStepBodyActions: [{ observedRevision: 5, time: time(20) }] });
    if (trigger === 'offline-undo') expect(sent[1]).toMatchObject({
      serviceOrderStepBodyActions: [{ time: time(30) }],
    });
    expect(harness.server.value?.steps).toEqual([{ id: 'step-1', title: 'Opening prayer',
      body: trigger === 'offline-undo' ? opening : 'My final text', scriptureRefs: ['John 1:1'] }]);
  } finally {
    editor.close();
    browser.dispose();
    jest.useRealTimers();
  }
});

it('keeps text entered before a new step reaches the editor and sends it after the add', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  browser.engine.setOnline(false);
  const input = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const structural = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT), { autoSaveOnResume: false });
  const added = { id: 'new-step', title: '', body: '', scriptureRefs: [] };
  const time = { earliestMs: 1795431000000, latestMs: 1795431000001 };
  const text = { field: 'body', stepId: added.id, before: '', value: 'Words for the new step.',
    time, version: { generation: 'order-generation', observedRevision: 5 }, waitingForStep: true } as const;
  jest.useFakeTimers();
  try {
    await input.stageServiceOrderInput(initial.value, undefined, text);
    expect(Object.values(input.getState().checkpoint.serviceOrderInputs ?? {})).toEqual([expect.objectContaining({
      waitingForStep: true, value: text.value, time,
    })]);
    expect(harness.transport.send).not.toHaveBeenCalled();
    await structural.commit(current => ({ ...current, steps: [...(current!.steps as DocumentData[]), added] }));
    await settleEngine();
    jest.advanceTimersByTime(700);
    await settleEngine();
    input.close();
    browser.engine.setOnline(true);
    await browser.engine.retry(resource);
    expect(harness.transport.send).toHaveBeenCalledTimes(2);
    expect(jest.mocked(harness.transport.send).mock.calls[1][0]).toMatchObject({
      serviceOrderStepBodyActions: [{ rowId: added.id, time }],
    });
    expect(harness.server.value?.steps).toContainEqual({ ...added, body: text.value });
  } finally {
    input.close();
    structural.close();
    browser.dispose();
    jest.useRealTimers();
  }
});

it.each(['Done', 'navigation'] as const)('flushes ordinary page input immediately on %s', async leave => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const page = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  jest.useFakeTimers();
  try {
    const body = screen.getByRole('textbox', { name: 'serviceOrders.stepWords' });
    fireEvent.change(body, { target: { value: 'The words immediately before leaving.' } });
    expect(harness.transport.send).not.toHaveBeenCalled();
    if (leave === 'Done') fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
    else page.rerender(<DataEngineProvider><p>List</p></DataEngineProvider>);
    await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
    expect(harness.transport.send).toHaveBeenCalledTimes(1);
    expect(harness.server.value?.steps).toEqual([{ id: 'step-1', title: 'Opening prayer',
      body: 'The words immediately before leaving.', scriptureRefs: ['John 1:1'] }]);
  } finally {
    page.unmount();
    await act(settleEngine);
    jest.useRealTimers();
  }
});

it('delivers only the field that blurred and preserves a later undo of the service title', async () => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const page = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  jest.useFakeTimers();
  try {
    await act(async () => { harness.engine.setOnline(false); await settleEngine(); });
    const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
    const body = screen.getByRole('textbox', { name: 'serviceOrders.stepWords' });
    fireEvent.change(body, { target: { value: 'Private sibling words.' } });
    fireEvent.change(title, { target: { value: 'Early evening service' } });
    fireEvent.blur(title);
    await act(settleEngine);
    const first = await harness.commits.list('owner');
    expect(first).toHaveLength(1);
    expect(first[0].value?.title).toBe('Early evening service');
    expect(first[0].value?.steps).toEqual(initial.value?.steps);
    fireEvent.change(title, { target: { value: 'Evening service' } });
    fireEvent.blur(title);
    await act(settleEngine);
    const second = (await harness.commits.list('owner')).find(commit => commit.id !== first[0].id);
    expect(second?.serviceOrderTitleAction).toMatchObject({ before: 'Early evening service', after: 'Evening service' });
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
    await act(async () => { await settleEngine(); harness.engine.setOnline(true); await harness.engine.retry(resource); await settleEngine(); });
    expect(harness.server.value).toMatchObject({ title: 'Evening service', steps: [{ id: 'step-1', body: 'Private sibling words.' }] });
  } finally {
    page.unmount();
    await act(settleEngine);
    jest.useRealTimers();
  }
});

it('follows a later change from another device after the editing session saves', async () => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  fireEvent.change(screen.getByRole('textbox', { name: 'serviceOrders.stepWords' }), { target: { value: 'Saved here.' } });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
  await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
  expect(harness.server.value?.steps).toEqual([expect.objectContaining({ body: 'Saved here.' })]);
  await act(async () => { await harness.remote({ steps: [{ id: 'step-1', title: 'Opening prayer', body: 'Edited on the phone.' }] }); });
  expect(await screen.findByText('Edited on the phone.')).toBeVisible();
  expect(screen.queryByText('Saved here.')).not.toBeInTheDocument();
  view.unmount();
  await act(settleEngine);
});

it.each(['acknowledged', 'refused'] as const)('handles an input on a newer shown revision when the preceding request is %s', async outcome => {
  const harness = documentEngineHarness(initial);
  const transport = jest.mocked(harness.transport.send);
  const send = transport.getMockImplementation()!;
  let acknowledge!: () => void;
  const pending = new Promise<void>(resolve => { acknowledge = resolve; });
  transport.mockImplementationOnce(async command => {
    await pending;
    if (outcome === 'refused') return { kind: 'refused', operationId: command.operationId, code: 'permission-denied' };
    return send(command);
  });
  const time = { earliestMs: 1795431000010, latestMs: 1795431000011 };
  const clock = jest.spyOn(actionClock, 'capture').mockReturnValue(undefined);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  try {
    await screen.findByRole('heading', { name: 'Evening service' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
    await act(settleEngine);
    const body = screen.getByRole('textbox', { name: 'serviceOrders.stepWords' });
    fireEvent.change(body, { target: { value: 'Body waiting to be acknowledged.' } });
    fireEvent.blur(body);
    await act(settleEngine);
    expect(transport).toHaveBeenCalledTimes(1);

    harness.silentRemote({ steps: [{ id: 'step-1', title: 'Prayer seen from the phone',
      body: 'The original paragraph.', scriptureRefs: ['John 1:1'] }] });
    await act(harness.refreshObservedResource);
    const heading = screen.getByRole('textbox', { name: 'serviceOrders.stepTitle' });
    expect(heading).toHaveValue('Prayer seen from the phone');
    clock.mockReturnValue(time);
    fireEvent.change(heading, { target: { value: 'Prayer revised after seeing the phone version' } });
    fireEvent.blur(heading);
    await act(settleEngine);
    expect(transport).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(undefined);
    await act(async () => { acknowledge(); await settleEngine(); });
    if (outcome === 'refused') {
      expect(await screen.findByText('dataSync.phase.refused')).toBeVisible();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(heading).toHaveValue('Prayer revised after seeing the phone version');
      const copies = await harness.checkpoints.listRecoverable('owner', resource);
      expect(copies[0]?.record.checkpoint.serviceOrderInputs?.['["step-1","title"]']).toMatchObject({
        value: 'Prayer revised after seeing the phone version', time,
      });
      return;
    }
    await waitFor(() => expect(harness.server.value?.steps).toEqual([{ id: 'step-1', title: 'Prayer revised after seeing the phone version',
      body: 'Body waiting to be acknowledged.', scriptureRefs: ['John 1:1'] }]));
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toMatchObject({ serviceOrderStepTitleActions: { title: {
      before: 'Prayer seen from the phone', after: 'Prayer revised after seeing the phone version', observedRevision: 6, time,
    } } });
  } finally {
    acknowledge();
    view.unmount();
    await act(settleEngine);
    clock.mockRestore();
  }
});

it('offers the words for copying when a step vanishes while the editor is open', async () => {
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  fireEvent.change(screen.getByRole('textbox', { name: 'serviceOrders.stepWords' }), { target: { value: 'Words from an open removed row.' } });
  await act(async () => { await harness.remote({ steps: [] }); });
  const recovery = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
  expect(recovery.getByText('Words from an open removed row.')).toBeVisible();
  expect(recovery.getByRole('button', { name: 'serviceOrders.copyRecoveredField' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: 'serviceOrders.stepWords' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
  await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.server.value?.steps).toEqual([]);
  view.unmount();
  await act(settleEngine);
});

it('shows an actual refusal while preserving what was entered through the ordinary editor', async () => {
  const harness = documentEngineHarness(initial, { apply: (command, current) => command.kind === 'update' && command.serviceOrderStepBodyActions
    ? { kind: 'refused', operationId: command.operationId, code: 'permission-denied' } : applyCommand(command, current) });
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  await screen.findByRole('heading', { name: 'Evening service' });
  fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
  await act(settleEngine);
  const body = screen.getByRole('textbox', { name: 'serviceOrders.stepWords' });
  fireEvent.change(body, { target: { value: 'Words kept after a refused write.' } });
  fireEvent.blur(body);
  await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
  expect(await screen.findByText('dataSync.phase.refused')).toBeVisible();
  expect(body).toHaveValue('Words kept after a refused write.');
  expect(harness.server).toEqual(initial);
  view.unmount();
  await act(settleEngine);
});

it('keeps the remote title and offers the captured local title when no clock orders the two', async () => {
  const clock = jest.spyOn(actionClock, 'capture').mockReturnValue(undefined);
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  try {
    await screen.findByRole('heading', { name: 'Evening service' });
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
    await act(settleEngine);
    harness.silentRemote({ title: 'Phone title' });
    const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
    fireEvent.change(title, { target: { value: 'Laptop title' } });
    fireEvent.blur(title);
    await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
    expect(harness.server.value?.title).toBe('Phone title');
    const comparison = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
    expect(comparison.getByText('Laptop title')).toBeVisible();
    expect(comparison.getByText('Phone title')).toBeVisible();
    expect(comparison.getByRole('button', { name: 'dataSync.useLocalVersion' })).toBeEnabled();
  } finally {
    view.unmount();
    await act(settleEngine);
    clock.mockRestore();
  }
});

it('offers an early new-step draft for explicit recovery after the add arrives', async () => {
  const harness = documentEngineHarness(initial);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const input = await browser.engine.openEditor(resource, browser.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  const added = { id: 'later-step', title: '', body: '', scriptureRefs: [] };
  const text = { field: 'body', stepId: added.id, before: '', value: 'Written while the creation had not arrived.',
    time: null, version: { generation: 'order-generation', observedRevision: 5 }, waitingForStep: true } as const;
  await input.stageServiceOrderInput(initial.value, undefined, text);
  input.close();
  await settleEngine();
  await harness.remote({ steps: [...initial.value!.steps as DocumentData[], added] });
  const [source] = await browser.engine.listRecoveryChoices(resource);
  expect(source.record.checkpoint.serviceOrderInputs).toBeDefined();
  const restored = await browser.engine.recoverEditor(resource, browser.editorId(resource, 'service-order-input'), source.id, { autoSaveOnResume: false });
  try {
    const fields = Object.values(restored.getState().checkpoint.serviceOrderInputs ?? {});
    expect(fields).toHaveLength(1);
    expect(fields[0].retainedOnly).toBeUndefined();
    expect(harness.transport.send).not.toHaveBeenCalled();
    await restored.saveServiceOrderInput(fields[0]);
    await browser.engine.retry(resource);
    expect(harness.transport.send).toHaveBeenCalledTimes(1);
    expect(harness.server.value?.steps).toContainEqual({ ...added, body: text.value });
  } finally {
    restored.close();
    browser.dispose();
    await settleEngine();
  }
});

it.each(['order title', 'step title'] as const)('restores the %s through the same session when history is available', async field => {
  jest.mocked(editHistoryShown).mockReturnValue(true);
  const decided = 'The earlier title';
  const isStep = field === 'step title';
  const titleOpening = { id: 'title-entry', title: decided, winnerTitle: 'Evening service' };
  const stepOpening = { id: 'step-entry', fields: [{ field: 'title', rowId: 'step-1', value: decided, winnerValue: 'Opening prayer' }] };
  jest.mocked(requestOwnerJson).mockResolvedValue({ value: { owner: 'owner', orderId: 'order-1',
    generation: 'order-generation', entries: [isStep ? stepOpening : titleOpening], nextCursor: null } } as never);
  const harness = documentEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
  try {
    const label = isStep ? 'serviceOrders.stepTitleHistory.title' : 'common.titleHistory';
    fireEvent.click(await screen.findByRole('button', { name: label }, { timeout: 5000 }));
    const restore = await screen.findByRole('button', { name: isStep ? 'serviceOrders.stepTitleHistory.restore' : 'common.titleHistoryRestore' });
    await waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(restore);
    await act(async () => { await settleEngine(); await harness.engine.retry(resource); });
    expect(harness.transport.send).toHaveBeenCalledTimes(1);
    expect(jest.mocked(harness.transport.send).mock.calls[0][0]).toMatchObject(isStep
      ? { serviceOrderStepTitleActions: { title: { rowId: 'step-1', before: 'Opening prayer', after: decided, observedRevision: 5 } } }
      : { serviceOrderTitleAction: { before: 'Evening service', after: decided, observedRevision: 5 } });
    if (isStep) expect(harness.server.value?.steps).toEqual([expect.objectContaining({ title: decided })]);
    else expect(harness.server.value?.title).toBe(decided);
  } finally {
    view.unmount();
    await act(settleEngine);
    jest.mocked(requestOwnerJson).mockImplementation(jest.requireActual('@/services/ownerHttpTransport.client').requestOwnerJson);
    jest.mocked(editHistoryShown).mockReturnValue(false);
  }
});

const presence = { held: async () => false as const, hold: () => () => undefined };
const startupStep = { id: 'step-1', title: 'Opening prayer', scriptureRefs: ['John 1:1'] };
const startupBody = 'The entire local word.';
const updatedStartupBody = 'Updated on the phone without opening this tab.';
const startupInput = { field: 'body', stepId: startupStep.id, before: 'The original paragraph.', value: startupBody, time: null,
  version: { generation: 'order-generation', observedRevision: 5 } } as const;

it.each([
  { changed: false, reserveOnly: false }, { changed: true, reserveOnly: false }, { changed: false, reserveOnly: true },
])('reopens service after startup, stored field changed=$changed reserve only=$reserveOnly', async ({ changed, reserveOnly }) => {
  const harness = documentEngineHarness(initial);
  const previous = harness.createBrowser({ recoveryPresence: presence });
  previous.engine.setOwner('owner');
  await previous.engine.retry();
  const old = await previous.engine.openEditor(resource, previous.editorId(resource, 'service-order-input'), { autoSaveOnResume: false });
  // Persist the exact field stamp produced before the editor's pause. A renderer crash cannot run the timer or flush.
  if (reserveOnly) harness.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint';
  const writing = old.edit({ ...initial.value, steps: [{ ...startupStep, body: startupInput.value }] },
    undefined, { field: 'service-order-input', input: startupInput });
  if (reserveOnly) {
    await expect(writing).rejects.toThrow();
    expect(await harness.checkpoints.listRecoverable('owner', resource)).toEqual([]);
    expect(findDraftCopies('owner', resource.id, 'service-order-input')).toHaveLength(1);
  } else {
    await writing;
    expect((await harness.checkpoints.listRecoverable('owner', resource))[0]?.record.checkpoint.serviceOrderInputs).toMatchObject({
      '["step-1","body"]': startupInput,
    });
  }
  expect(harness.transport.send).not.toHaveBeenCalled();
  if (reserveOnly) old.dispose();
  else old.close();
  await settleEngine();
  previous.dispose();
  harness.storage.writeFailureFor = undefined;
  if (changed) harness.silentRemote({ steps: [{ ...startupStep, body: updatedStartupBody }] });
  const reopened = harness.createBrowser({ withCollections: true, recoveryPresence: presence });
  let view: ReturnType<typeof render> | undefined;
  try {
    reopened.engine.setOwner('owner');
    await reopened.engine.retry();
    await reopened.engine.retry();
    expect(harness.transport.send).toHaveBeenCalledTimes(changed ? 0 : 1);
    expect(harness.server.value?.steps).toEqual([{ ...startupStep, body: changed ? updatedStartupBody : startupInput.value }]);
    jest.mocked(createBrowserDataEngine).mockReturnValue(reopened);
    view = render(<DataEngineProvider><ServiceOrderPage /></DataEngineProvider>);
    await screen.findByRole('heading', { name: 'Evening service' });
    await act(settleEngine);
    if (changed) {
      fireEvent.click(await screen.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
      const review = within(await screen.findByRole('region', { name: 'dataSync.reviewSavedChange' }));
      expect(await review.findByText(startupInput.value)).toBeInTheDocument();
      expect(await review.findByText(updatedStartupBody)).toBeInTheDocument();
      expect(harness.transport.send).not.toHaveBeenCalled();
    } else {
      expect(screen.queryByRole('button', { name: 'dataSync.reviewSavedChange' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'dataSync.reviewSavedChange' })).not.toBeInTheDocument();
    }
  } finally {
    view?.unmount();
    await act(settleEngine);
    reopened.dispose();
  }
});
