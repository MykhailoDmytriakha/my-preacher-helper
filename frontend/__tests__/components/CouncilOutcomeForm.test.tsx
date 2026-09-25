import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { CouncilOutcomeForm } from '@/components/council/CouncilOutcomeForm';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataEngine } from '@/data-engine/engine';
import { createIndexedDbManualScopes } from '@/data-engine/manualScopes.client';
import { ResourceObserver } from '@/data-engine/observer';
import { applyCommand } from '@/data-engine/protocol';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';
import { useAuth } from '@/providers/AuthProvider';

import type { BrowserDataEngine } from '@/data-engine/browser.client';
import type { EngineTransport, JournalEntry, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'councils', id: 'council' };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

function setup() {
  installStorageHarness();
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'owner' } } as ReturnType<typeof useAuth>);
  let server: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: {
    userId: 'owner', title: 'Council', status: 'held', createdAt: '2026-09-19', updatedAt: '2026-09-19',
    topics: [{ id: 'topic', title: 'Decision', questions: [], options: [], decision: 'Original', discussed: true }],
  } };
  let cached = copy(server), sequence = 0;
  const journal = new Map<string, JournalEntry>();
  const transport: EngineTransport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async command => {
      const result = applyCommand(command, server);
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    }),
  };
  const commits = createIndexedDbCommitStore();
  let engine!: DataEngine;
  jest.mocked(createBrowserDataEngine).mockImplementation(() => {
    const runtime = new DataEngineRuntime({ transport, journal: {
    list: async () => [...journal.values()].map(copy),
    put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
    remove: async (_owner, id) => { journal.delete(id); },
  } });
  const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
  const instance = new DataEngine({ runtime, observer, transport, commits,
    checkpoints: createIndexedDbCheckpoints(), manualScopes: createIndexedDbManualScopes(),
    snapshots: { read: async () => cached, put: async (_owner, value) => { cached = copy(value); } },
    operationId: () => `operation-${++sequence}`,
  });
  engine = instance;
  const browser: BrowserDataEngine = { engine: instance, dispose: () => instance.dispose(), editorId: () => `editor-${++sequence}` };
  return browser;
  });
  let document!: ReturnType<typeof useDataDocument>;
  function Parent() {
    document = useDataDocument(resource);
    return <DataSyncStatus status={document.status} error={document.error}
      onAcceptRemote={document.acceptRemote} onKeepLocal={document.keepLocal} />;
  }
  const onClose = jest.fn();
  function Workspace({ show = true }) {
    return <DataEngineProvider><DataDocumentProvider resource={resource}>
      <Parent />{show && <CouncilOutcomeForm councilId="council" topicId="topic" onClose={onClose} />}
    </DataDocumentProvider></DataEngineProvider>;
  }
  const view = render(<Workspace />);
  return { view, Workspace, get engine() { return engine; }, commits, transport, onClose, get document() { return document; }, get server() { return server; },
    remote: async () => {
      server = { ...server, metadata: { ...server.metadata!, revision: 2 }, value: { ...server.value,
        topics: [{ id: 'topic', title: 'Decision', questions: [], options: [], decision: 'Remote', discussed: true }],
      } };
      await act(async () => { await engine.retry(resource); await settle(); });
    },
  };
}

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('pins the open outcome, keeps typing stage-only, and conflicts after a remote change', async () => {
  const s = setup();
  const input = await screen.findByPlaceholderText('council.topic.decisionPlaceholder');
  fireEvent.change(input, { target: { value: 'Mine' } });
  await act(async () => { await settle(); jest.advanceTimersByTime(1500); await settle(); });
  expect(s.transport.send).not.toHaveBeenCalled();
  expect(s.document.data).toMatchObject({ topics: [{ decision: 'Original' }] });
  await s.remote();
  expect(input).toHaveValue('Mine');
  expect(s.document.data).toMatchObject({ topics: [{ decision: 'Remote' }] });
  fireEvent.click(screen.getByRole('button', { name: 'council.topic.saveOutcome' }));
  await waitFor(() => expect(s.onClose).toHaveBeenCalledTimes(1));
  await act(async () => { await s.engine.retry(); await settle(); });
  expect(s.document.status?.phase).toBe('conflict');
  expect(s.document.data).toMatchObject({ topics: [{ decision: 'Mine' }] });
  expect(s.server.value).toMatchObject({ topics: [{ decision: 'Remote' }] });
  await act(async () => { await s.document.acceptRemote(); await settle(); });
  expect(await createIndexedDbManualScopes().list('owner', resource)).toEqual([]);
  s.view.rerender(<s.Workspace show={false} />);
  s.view.rerender(<s.Workspace />);
  await waitFor(() => expect(screen.getByPlaceholderText('council.topic.decisionPlaceholder')).toHaveValue('Remote'));
  s.view.unmount();
});

it('cancels the durable stage without sending it', async () => {
  const s = setup();
  fireEvent.change(await screen.findByPlaceholderText('council.topic.decisionPlaceholder'), { target: { value: 'Cancelled' } });
  await act(async () => { await settle(); });
  fireEvent.click(screen.getByRole('button', { name: 'council.cancel' }));
  await waitFor(() => expect(s.onClose).toHaveBeenCalled());
  expect(await s.commits.list('owner')).toEqual([]);
  expect(s.transport.send).not.toHaveBeenCalled();
  expect(s.document.data).toMatchObject({ topics: [{ decision: 'Original' }] });
  s.view.unmount();
});

it('reopens an unfinished form stage without delivering it', async () => {
  const s = setup();
  fireEvent.change(await screen.findByPlaceholderText('council.topic.decisionPlaceholder'), { target: { value: 'Unfinished' } });
  await act(async () => { await settle(); });
  s.view.rerender(<s.Workspace show={false} />);
  s.view.rerender(<s.Workspace />);
  await waitFor(() => expect(screen.getByPlaceholderText('council.topic.decisionPlaceholder')).toHaveValue('Unfinished'));
  expect(s.transport.send).not.toHaveBeenCalled();
  s.view.unmount();
});

it('offers a prior engine lifetime stage for explicit recovery without sending it on restart', async () => {
  const s = setup();
  fireEvent.change(await screen.findByPlaceholderText('council.topic.decisionPlaceholder'), { target: { value: 'Before restart' } });
  await act(async () => { await settle(); });
  s.view.unmount();
  const reopened = render(<s.Workspace />);
  const choice = await screen.findByRole('option', { name: 'Decision' });
  expect(screen.getByPlaceholderText('council.topic.decisionPlaceholder')).toHaveValue('Original');
  expect(s.transport.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: (choice as HTMLOptionElement).value } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await waitFor(() => expect(screen.getByPlaceholderText('council.topic.decisionPlaceholder')).toHaveValue('Before restart'));
  expect(s.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'council.topic.saveOutcome' }));
  await waitFor(() => expect(s.onClose).toHaveBeenCalled());
  await act(async () => { await s.engine.retry(); await settle(); });
  expect(s.server.value).toMatchObject({ topics: [{ decision: 'Before restart', changes: [{ from: 'Original', to: 'Before restart' }] }] });
  reopened.unmount();
});
