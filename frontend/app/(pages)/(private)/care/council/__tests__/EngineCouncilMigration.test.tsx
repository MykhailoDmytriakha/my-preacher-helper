import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { clearLocalCouncils, readLocalCouncils } from '@/services/councils.local';

import { EngineCouncilMigration } from '../EngineCouncilMigration';

import type { Council } from '@/models/models';

jest.mock('@/services/councils.local', () => ({ readLocalCouncils: jest.fn(), clearLocalCouncils: jest.fn() }));

const created: string[] = [];
const createdWith: Council[] = [];
let failNext: string | null = null;
jest.mock('../EngineCouncilCreator', () => ({
  EngineCouncilCreator: ({ council, onCreated, onFailed }: { council: Council; onCreated: (id: string) => void; onFailed: (message: string) => void }) => {
    React.useEffect(() => {
      if (failNext === council.id) { onFailed('refused'); return; }
      created.push(council.id); createdWith.push(council);
      onCreated(council.id);
    }, [council, onCreated, onFailed]);
    return <div data-testid={`creating-${council.id}`} />;
  },
}));

const local = (id: string): Council => ({
  id, userId: 'owner', title: `Council ${id}`, status: 'preparing', topics: [], createdAt: 'then', updatedAt: 'then',
});

beforeEach(() => { jest.clearAllMocks(); created.length = 0; createdWith.length = 0; failNext = null; });

describe('EngineCouncilMigration', () => {
  // The browser copies were written by code that is gone and come back unvalidated. The engine
  // refuses a NEW document with any field outside its schema, and the legacy model carries `rev`.
  it('hands the engine only the fields a council may have', async () => {
    jest.mocked(readLocalCouncils).mockReturnValue([{ ...local('a'), rev: 0, date: '2026-09-20', leftover: 'from an older build' } as unknown as Council]);
    render(<EngineCouncilMigration owner="owner" serverIds={new Set()} />);
    await waitFor(() => expect(createdWith).toHaveLength(1));
    expect(createdWith[0]).toEqual({ id: 'a', userId: 'owner', title: 'Council a', status: 'preparing', topics: [], createdAt: 'then', updatedAt: 'then', date: '2026-09-20' });
  });

  it('says so when the carry-over stops, because these councils exist nowhere else', async () => {
    jest.mocked(readLocalCouncils).mockReturnValue([local('a')]);
    failNext = 'a';
    const onRefused = jest.fn();
    render(<EngineCouncilMigration owner="owner" serverIds={new Set()} onRefused={onRefused} />);
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith('refused'));
    expect(clearLocalCouncils).not.toHaveBeenCalled();
  });

  it('carries only what the server does not already have, one at a time', async () => {
    jest.mocked(readLocalCouncils).mockReturnValue([local('a'), local('b'), local('already')]);
    render(<EngineCouncilMigration owner="owner" serverIds={new Set(['already'])} />);

    await waitFor(() => expect(created).toEqual(['a', 'b']));
    await waitFor(() => expect(clearLocalCouncils).toHaveBeenCalledWith('owner'));
  });

  // The browser copy is the only copy. Clearing it after a partial carry destroys what never
  // reached the database, so a refusal leaves everything where it is for the next attempt.
  it('keeps the browser copy when a council is refused', async () => {
    jest.mocked(readLocalCouncils).mockReturnValue([local('a'), local('b')]);
    failNext = 'b';
    render(<EngineCouncilMigration owner="owner" serverIds={new Set()} />);

    await waitFor(() => expect(created).toEqual(['a']));
    // The refusal has to be observed as a stop, not merely as "the queue did not advance":
    // a component that keeps going would reach the end and wipe the only copy these councils have.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(created).toEqual(['a']);
    expect(clearLocalCouncils).not.toHaveBeenCalled();
  });

  it('does nothing until the server has answered, and nothing when there is nothing to carry', () => {
    jest.mocked(readLocalCouncils).mockReturnValue([local('a')]);
    const { unmount } = render(<EngineCouncilMigration owner="owner" serverIds={null} />);
    expect(created).toEqual([]);
    expect(clearLocalCouncils).not.toHaveBeenCalled();
    unmount();

    jest.mocked(readLocalCouncils).mockReturnValue([]);
    render(<EngineCouncilMigration owner="owner" serverIds={new Set()} />);
    expect(created).toEqual([]);
    expect(clearLocalCouncils).not.toHaveBeenCalled();
  });
});
