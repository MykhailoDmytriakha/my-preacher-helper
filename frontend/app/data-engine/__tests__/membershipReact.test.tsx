import { act, renderHook, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { createBrowserDataEngine, type BrowserDataEngine } from '../browser.client';
import { MembershipScope } from '../membershipScope';
import { DataEngineProvider, useDataMembership } from '../react.client';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
const Wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode><DataEngineProvider>{children}</DataEngineProvider></StrictMode>;
const owner = (uid: string) => jest.mocked(useAuth).mockReturnValue({ user: { uid } } as never);
function fixture() {
  owner('owner');
  const save = jest.fn(async () => [{ id: 'saved' }]);
  const scope = MembershipScope.begin('owner', 'scope', [{ baseline: { resource: { collection: 'series', id: 's' }, metadata: null,
    value: { userId: 'owner', title: 'Series', items: [{ id: 'group-g', type: 'group', refId: 'g', position: 1 }], sermonIds: [], seriesKind: 'group' } }, predecessor: null }],
  { isCurrent: () => true, persist: async (record, revision) => ({ ...record, revision: (revision ?? -1) + 1 }), save });
  const engine = { setOwner: jest.fn(), beginMembership: jest.fn(async () => scope), recoverMembership: jest.fn(async () => scope),
    releaseMembership: jest.fn(), listMembershipRecovery: jest.fn(async () => [scope.getState().record]) };
  const browser = { engine, dispose: jest.fn(), editorId: jest.fn() } as unknown as BrowserDataEngine;
  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  return { scope, engine, browser, save };
}
it('offers semantic staging, explicit Save and release through the public hook under StrictMode', async () => {
  const t = fixture(), { result, unmount } = renderHook(useDataMembership, { wrapper: Wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => { await result.current.begin(); });
  expect(result.current.values[0].value.title).toBe('Series');
  await act(async () => { await result.current.update({ kind: 'remove', refs: [{ type: 'group', refId: 'g' }] }); });
  expect(t.save).not.toHaveBeenCalled(); expect(result.current.values[0].value.items).toEqual([]);
  await act(async () => { await result.current.save(); }); expect(result.current.phase).toBe('submitted');
  unmount(); expect(t.engine.releaseMembership).toHaveBeenCalledWith('scope');
});
it('exposes errors, retry and explicit stage recovery without automatically submitting', async () => {
  const t = fixture(), { result } = renderHook(useDataMembership, { wrapper: Wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => { expect(await result.current.listRecoverable()).toHaveLength(1); await result.current.recover('scope'); });
  expect(t.save).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.update({ kind: 'assign', targetId: 'absent', refs: [{ type: 'group', refId: 'g' }] })).rejects.toThrow('target'); });
  expect(result.current.error).toContain('target');
  await act(async () => { await result.current.retry(); }); expect(result.current.error).toBeNull();
  await act(async () => { await result.current.cancel(); }); expect(result.current.phase).toBeNull();
  expect(t.engine.releaseMembership).toHaveBeenCalledWith('scope');
});
it('clears the old account immediately and refuses stale callbacks and late openings', async () => {
  const t = fixture(); let resolve!: (scope: MembershipScope) => void;
  t.engine.beginMembership.mockReturnValue(new Promise(done => { resolve = done; }));
  const { result, rerender } = renderHook(useDataMembership, { wrapper: Wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  const old = result.current; let opening!: Promise<void>;
  act(() => { opening = old.begin(); });
  owner('other'); rerender(); expect(result.current.values).toEqual([]);
  await act(async () => { resolve(t.scope); await expect(opening).rejects.toThrow('changed'); });
  expect(t.engine.releaseMembership).toHaveBeenCalledWith('scope');
  await expect(old.update(null)).rejects.toThrow('changed'); expect(result.current.error).toBeNull();
});
it('remains idle in an unmigrated deployment with no provider', () => {
  const { result } = renderHook(useDataMembership); expect(result.current.ready).toBe(false); expect(result.current.values).toEqual([]);
  expect(() => result.current.begin()).toThrow('changed');
});
