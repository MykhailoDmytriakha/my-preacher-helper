import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { useScratchDataDocument } from '../useScratchDataDocument';

let mockOwner: string | null = 'owner';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockOwner ? { uid: mockOwner } : null }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'scratch-sermon' };
const first = { id: 'first', text: 'Original deleted thought', createdAt: '2026-10-17T00:00:00.000Z', section: 'main' as const };
const sibling = { id: 'sibling', text: 'Keep the sibling thought', createdAt: '2026-10-17T00:00:01.000Z' };

function setup() {
  const harness = documentEngineHarness({ resource,
    value: { userId: 'owner', title: 'Original sermon', verse: 'John 3:16', date: '2026-10-17', thoughts: [], scratch: [first, sibling] },
    metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  let undo: (() => unknown) | null = null;
  let leave: () => void = () => undefined;
  let enter: () => void = () => undefined;
  let undoFinished = Promise.resolve<unknown>(undefined);
  const errors: unknown[] = [];
  function Scratch() {
    const scratch = useScratchDataDocument(resource.id);
    return <><output data-testid="scratch">{JSON.stringify(scratch.notes)}</output><button onClick={() => {
      // The global notice retains this exact domain callback after the screen closes.
      undo = () => scratch.restoreScratchNote(first);
      scratch.deleteScratchNote(first.id);
    }}>Delete original thought</button></>;
  }
  function Host() {
    const [open, setOpen] = useState(true);
    leave = () => setOpen(false);
    enter = () => setOpen(true);
    return <DataEngineProvider>{open ? <Scratch /> : <p>Another screen</p>}<button onClick={() => {
      undoFinished = Promise.resolve(undo?.()).catch(error => { errors.push(error); });
    }}>Undo deleted thought</button></DataEngineProvider>;
  }
  const view = render(<Host />);
  return { harness, view, errors, leave: () => leave(), enter: () => enter(), waitUndo: () => undoFinished, changeOwner: (owner: string | null) => { mockOwner = owner; view.rerender(<Host />); } };
}

async function remove(harness: ReturnType<typeof documentEngineHarness>) {
  await waitFor(() => expect(screen.getByTestId('scratch')).toHaveTextContent(first.text));
  fireEvent.click(screen.getByRole('button', { name: 'Delete original thought' }));
  await waitFor(async () => { await settleEngine(); expect(harness.server.value?.scratch).toEqual([sibling]); });
}

beforeEach(() => { jest.clearAllMocks(); mockOwner = 'owner'; });

describe('scratch delete Undo across editor lifetimes', () => {
  it('restores the original thought after leaving and preserves later saved sibling words', async () => {
    const { harness, leave, errors } = setup();
    await remove(harness);
    act(() => leave());
    const laterSibling = { ...sibling, text: 'Later saved sibling words' };
    const later = { id: 'later', text: 'A later thought', createdAt: '2026-10-17T00:00:02.000Z' };
    await act(async () => { await harness.remote({ title: 'Later sermon title', scratch: [laterSibling, later] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await waitFor(async () => {
      await settleEngine();
      expect(harness.server.value?.scratch).toEqual([first, laterSibling, later]);
    });
    expect(harness.server.value?.title).toBe('Later sermon title');
    expect(errors).toEqual([]);
  });

  it('keeps same-screen restoration of the exact thought and sibling working', async () => {
    const { harness, errors } = setup();
    await remove(harness);
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.scratch).toEqual([first, sibling]); });
    expect(errors).toEqual([]);
  });

  it('shows an Undo captured offline after the deletion was acknowledged', async () => {
    const { harness, errors } = setup();
    await remove(harness);
    act(() => { harness.engine.setOnline(false); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await waitFor(async () => { await settleEngine(); expect(await harness.commits.list('owner')).toHaveLength(1); });
    expect(harness.server.value?.scratch).toEqual([sibling]);
    await waitFor(() => expect(screen.getByTestId('scratch')).toHaveTextContent(first.text));
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.scratch).toEqual([first, sibling]); });
    expect(errors).toEqual([]);
  });


  it('rejects the retained Undo after signing out without changing stored notes', async () => {
    const { harness, leave, changeOwner, errors } = setup();
    await remove(harness);
    act(() => { leave(); changeOwner(null); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(harness.server.value?.scratch).toEqual([sibling]);
    expect(harness.transport.send).toHaveBeenCalledTimes(1);
  });

  it('keeps an unseen deleted sermon deleted and retains the restore intent for a decision', async () => {
    const { harness, leave } = setup();
    await remove(harness); act(() => leave()); harness.silentRemoteDelete();
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await waitFor(async () => {
      await settleEngine();
      const records = await harness.engine.listRecoverable(resource);
      expect(records.some(record => record.answer === 'conflict')).toBe(true);
      expect(records.some(record => JSON.stringify(record.record.checkpoint.draft?.scratch).includes(first.text))).toBe(true);
    });
    expect(harness.server.value).toBeNull();
    expect(harness.server.metadata?.deleted).toBe(true);
    expect(harness.transport.send).toHaveBeenCalledTimes(2);
  });


  it('keeps immediate delete, leave and Undo ordered while offline before the first capture settles', async () => {
    const { harness, leave, enter, waitUndo, errors } = setup();
    await waitFor(() => expect(screen.getByTestId('scratch')).toHaveTextContent(first.text));
    act(() => { harness.engine.setOnline(false); });
    fireEvent.click(screen.getByRole('button', { name: 'Delete original thought' }));
    act(() => leave());
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleted thought' }));
    await act(async () => { await waitUndo(); await settleEngine(); });
    act(() => enter());
    await waitFor(() => expect(screen.getByTestId('scratch')).toHaveTextContent(first.text));
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
    await waitFor(async () => {
      await settleEngine();
      const requests = await harness.commits.list('owner');
      expect(requests.every(request => request.state === 'acknowledged')).toBe(true);
      expect(harness.server.value?.scratch).toEqual([first, sibling]);
    });
    expect(errors).toEqual([]);
  });

});
