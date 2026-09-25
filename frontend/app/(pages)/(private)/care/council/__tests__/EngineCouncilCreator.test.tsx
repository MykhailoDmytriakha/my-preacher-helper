import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { useDataDocument } from '@/data-engine/react.client';

import { EngineCouncilCreator } from '../EngineCouncilCreator';

import type { DocumentData } from '@/data-engine/types';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn() }));

const draft = { id: 'council-1', userId: 'owner', title: 'Prepared', status: 'preparing' as const, topics: [], createdAt: 'now', updatedAt: 'now' };

function mockDocument(overrides: Partial<ReturnType<typeof useDataDocument>> = {}) {
  const commit = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useDataDocument).mockReturnValue({ commit, loading: false, error: null, status: null } as unknown as ReturnType<typeof useDataDocument>);
  if (overrides.commit) jest.mocked(useDataDocument).mockReturnValue({ ...overrides, commit: overrides.commit, loading: false, error: null } as unknown as ReturnType<typeof useDataDocument>);
  return commit;
}

beforeEach(() => jest.clearAllMocks());

describe('EngineCouncilCreator', () => {
  it('submits the council it was given, once, and reports the finished id', async () => {
    const commit = mockDocument();
    const onCreated = jest.fn();
    const { rerender } = render(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    // The engine asks the caller for the value; a create has no earlier draft to build on.
    const produced = (commit.mock.calls[0][0] as (current: DocumentData | null) => DocumentData)(null);
    expect(produced).toMatchObject({ userId: 'owner', title: 'Prepared', status: 'preparing', topics: [] });
    expect(produced).not.toHaveProperty('id');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('council-1'));

    // A re-render must not send the same council a second time under the same id.
    rerender(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  it('hands a refusal back instead of pretending the council exists', async () => {
    const commit = jest.fn().mockRejectedValue(new Error('permission-denied'));
    mockDocument({ commit } as Partial<ReturnType<typeof useDataDocument>>);
    const onCreated = jest.fn();
    const onFailed = jest.fn();
    render(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={onFailed} />);

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('permission-denied'));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('opens the editor for this council as a create, with autosave off', () => {
    mockDocument();
    render(<EngineCouncilCreator council={draft} onCreated={jest.fn()} onFailed={jest.fn()} />);
    expect(jest.mocked(useDataDocument)).toHaveBeenCalledWith(
      { collection: 'councils', id: 'council-1' },
      expect.objectContaining({ create: true, autoSave: false })
    );
  });

  // The editor opens asynchronously. Submitting before it is ready is refused by the engine, so
  // the council is never created — the failure this test exists to prevent.
  it('waits for the editor before submitting', async () => {
    const commit = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useDataDocument).mockReturnValue({ commit, loading: true, error: null } as unknown as ReturnType<typeof useDataDocument>);
    const onCreated = jest.fn();
    const { rerender } = render(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    await waitFor(() => expect(commit).not.toHaveBeenCalled());

    jest.mocked(useDataDocument).mockReturnValue({ commit, loading: false, error: null } as unknown as ReturnType<typeof useDataDocument>);
    rerender(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('council-1'));
  });

  // The document's state changes while the create is in flight. If that re-run cancels the
  // report, the screen never learns the council exists: the form stays stuck and the button dies.
  it('still reports the created council when the document state changes mid-flight', async () => {
    let settle: (() => void) | undefined;
    const commit = jest.fn().mockImplementation(() => new Promise<void>(resolve => { settle = () => resolve(); }));
    jest.mocked(useDataDocument).mockReturnValue({ commit, loading: false, error: null } as unknown as ReturnType<typeof useDataDocument>);
    const onCreated = jest.fn();
    const { rerender } = render(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    // The engine reopens the document as the create lands, so readiness flips while the request
    // is in the air. A cancellation tied to that re-run swallows the answer and the screen hangs.
    jest.mocked(useDataDocument).mockReturnValue({ commit, loading: true, error: null } as unknown as ReturnType<typeof useDataDocument>);
    rerender(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    jest.mocked(useDataDocument).mockReturnValue({ commit, loading: false, error: null } as unknown as ReturnType<typeof useDataDocument>);
    rerender(<EngineCouncilCreator council={draft} onCreated={onCreated} onFailed={jest.fn()} />);
    settle!();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('council-1'));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('renders nothing: it is a lifecycle, not a view', () => {
    mockDocument();
    const { container } = render(<EngineCouncilCreator council={draft} onCreated={jest.fn()} onFailed={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
