import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { documentScreenHref, isOnDocumentScreen } from '@/utils/documentScreenHref';
import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { User } from 'firebase/auth';

jest.mock('next/navigation', () => ({ usePathname: () => '/settings/templates' }));
let mockOwner = 'owner';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: mockOwner } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const resource = { collection: 'planTemplates', id: 'tpl' };
const NAME = 'Point kept through capture';
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const snapshot = () => ({ resource, value: { userId: 'owner', name: 'Alpha',
  structure: { introduction: [], main: [{ id: 'retained', text: 'Retained point' }], conclusion: [] },
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
  metadata: { protocol: 1 as const, generation: 'template-v1', revision: 1, deleted: false } });

async function setup({ banner = false, requested }: { banner?: boolean; requested?: string } = {}) {
  const harness = documentEngineHarness(snapshot());
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  const view = render(<DataEngineProvider>{banner && <EngineConflictBanner pollMs={50} />}<PlanTemplatesSection user={{ uid: 'owner' } as User} requestedTemplateId={requested} /></DataEngineProvider>);
  await screen.findByText('Alpha');
  if (!requested) fireEvent.click(screen.getByLabelText('common.expand'));
  await waitFor(() => expect(screen.getAllByText('structure.addPointButton')[0]).toBeEnabled());
  return { harness, view };
}

function addPoint() {
  fireEvent.click(screen.getAllByText('structure.addPointButton')[0]);
  const input = screen.getByPlaceholderText('structure.addPointPlaceholder');
  fireEvent.change(input, { target: { value: NAME } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); mockOwner = 'owner'; process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'planTemplates'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('inline template capture and folding', () => {
  it('routes a retained template draft to its exact outline editor', () => {
    expect(documentScreenHref(resource)).toBe('/settings/templates?template=tpl');
    expect(isOnDocumentScreen('/settings/templates', resource)).toBe(true);
    expect(documentScreenHref({ collection: 'planTemplates', id: 'a/b ?' })).toBe('/settings/templates?template=a%2Fb%20%3F');
  });

  it('makes a delivery refusal after folding discoverable and restores the same canonical points on reopening', async () => {
    const { harness, view } = await setup({ banner: true });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    jest.mocked(harness.transport.send).mockImplementation(async command => {
      await held;
      return { kind: 'refused', operationId: command.operationId, code: 'permission-denied' };
    });
    try {
      addPoint();
      fireEvent.click(screen.getByLabelText('common.collapse'));
      await waitFor(() => expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument());
      await act(async () => { release(); await settleEngine(); await settleEngine(); });
      const link = await screen.findByRole('link', { name: 'dataSync.openToDecide' });
      expect(link).toHaveAttribute('href', '/settings/templates?template=tpl');
      expect(screen.getByRole('alert')).toHaveTextContent(NAME);
      fireEvent.click(screen.getByLabelText('common.expand'));
      await waitFor(() => expect(screen.getByText('dataSync.keepLocal')).toBeInTheDocument());
      expect(screen.getByText(NAME)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('link', { name: 'dataSync.openToDecide' })).not.toBeInTheDocument());
      expect((await harness.commits.list('owner')).filter(row => row.state === 'refused')).toHaveLength(1);
      expect(harness.transport.send).toHaveBeenCalledTimes(1);
      expect(harness.server.value?.structure).toEqual(snapshot().value.structure);
    } finally {
      release(); view.unmount();
      await act(async () => { await pause(450); await settleEngine(); });
    }
  });

  it('opens the exact template requested by the recovery route', async () => {
    const { view } = await setup({ requested: 'tpl' });
    expect(screen.getByLabelText('common.collapse')).toBeInTheDocument();
    expect(screen.getByText('Retained point')).toBeInTheDocument();
    view.unmount(); await act(settleEngine);
  });

  it('removes an open unsent outline through its own editor without reviving its points', async () => {
    const { harness, view } = await setup();
    try {
      harness.engine.setOnline(false);
      addPoint(); await act(settleEngine);
      fireEvent.click(screen.getAllByLabelText('common.delete')[0]);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'common.delete' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument();
      const commits = await harness.commits.list('owner');
      expect(commits).toHaveLength(1);
      expect(commits[0].value).toBeNull();
      await act(async () => { await pause(450); await settleEngine(); harness.engine.setOnline(true); await settleEngine(); });
      await waitFor(() => expect(harness.server.value).toBeNull());
      expect(harness.transport.send).toHaveBeenCalledTimes(1);
      expect(harness.server.metadata?.deleted).toBe(true);
    } finally { view.unmount(); await act(settleEngine); }
  });

  it('does not let an earlier owner capture completion reopen a template for the next owner', async () => {
    const { harness, view } = await setup();
    try {
      harness.storage.holdCompletionAfterCommit = (rows, mode) => mode === 'readwrite'
        && [...rows.values()].some(row => JSON.stringify(row).includes(NAME));
      addPoint(); await act(settleEngine);
      fireEvent.click(screen.getByLabelText('common.collapse'));
      await act(settleEngine);
      mockOwner = 'second-owner';
      view.rerender(<DataEngineProvider><PlanTemplatesSection user={{ uid: mockOwner } as User} /></DataEngineProvider>);
      expect(screen.queryByText(NAME)).not.toBeInTheDocument();
      harness.storage.holdCompletionAfterCommit = undefined;
      await act(async () => { harness.storage.finishCompletion(); await settleEngine(); });
      expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument();
      expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    } finally {
      harness.storage.holdCompletionAfterCommit = undefined; harness.storage.finishCompletion();
      view.unmount(); await act(settleEngine);
    }
  });

  it('keeps the point and editor open after capture failure, then supports a deliberate fold retry', async () => {
    const { harness, view } = await setup();
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      harness.storage.writeFailure = true;
      addPoint();
      expect(screen.getByText(NAME)).toBeInTheDocument();
      await act(async () => { await pause(450); await settleEngine(); });
      fireEvent.click(screen.getByLabelText('common.collapse'));
      await act(settleEngine);
      expect(screen.getByText(NAME)).toBeInTheDocument();
      expect(screen.getByLabelText('common.collapse')).toBeInTheDocument();
      expect(harness.transport.send).not.toHaveBeenCalled();

      harness.storage.writeFailure = false;
      fireEvent.click(screen.getByLabelText('common.collapse'));
      await waitFor(() => expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument());
      fireEvent.click(screen.getByLabelText('common.expand'));
      expect(await screen.findByText(NAME)).toBeInTheDocument();
      await waitFor(() => expect(harness.server.value?.structure).toEqual(expect.objectContaining({
        introduction: [expect.objectContaining({ text: NAME })], main: [expect.objectContaining({ text: 'Retained point' })],
      })));
      expect(harness.server.value?.name).toBe('Alpha');
    } finally {
      harness.storage.writeFailure = false;
      view.unmount();
      await act(async () => { await pause(450); await settleEngine(); });
      log.mockRestore();
    }
  });

  it('waits for the actual checkpoint completion before folding an editor with newly typed points', async () => {
    const { harness, view } = await setup();
    try {
      harness.storage.holdCompletionAfterCommit = (rows, mode) => mode === 'readwrite'
        && [...rows.values()].some(row => JSON.stringify(row).includes(NAME));
      addPoint();
      await act(settleEngine);
      fireEvent.click(screen.getByLabelText('common.collapse'));
      await act(settleEngine);
      expect(screen.getByText(NAME)).toBeInTheDocument();
      expect(screen.getByLabelText('common.collapse')).toBeDisabled();
      harness.storage.holdCompletionAfterCommit = undefined;
      await act(async () => { harness.storage.finishCompletion(); await settleEngine(); });
      await waitFor(() => expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument());
      fireEvent.click(screen.getByLabelText('common.expand'));
      expect(await screen.findByText(NAME)).toBeInTheDocument();
    } finally {
      harness.storage.holdCompletionAfterCommit = undefined;
      harness.storage.finishCompletion();
      view.unmount();
      await act(async () => { await pause(450); await settleEngine(); });
    }
  });

  it('keeps immediate point display and captures once when the page hides before its delivery delay', async () => {
    const { harness, view } = await setup();
    try {
      harness.engine.setOnline(false);
      addPoint();
      expect(screen.getByText(NAME)).toBeInTheDocument();
      await act(settleEngine);
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await settleEngine(); });
      const own = (await harness.commits.list('owner')).filter(row => row.baseline.resource.id === resource.id);
      expect(own).toHaveLength(1);
      expect(own[0].value?.structure).toEqual(expect.objectContaining({ introduction: [expect.objectContaining({ text: NAME })] }));
      await act(async () => { await pause(450); await settleEngine(); });
      expect(await harness.commits.list('owner')).toHaveLength(1);
      expect(harness.transport.send).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      view.unmount();
      await act(settleEngine);
    }
  });
});
