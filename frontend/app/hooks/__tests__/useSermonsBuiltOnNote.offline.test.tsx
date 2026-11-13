import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { useAuth } from '@/providers/AuthProvider';
import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const snapshot = (id: string, date: string, sourceNoteIds?: string[], userId = 'u1'): ResourceSnapshot => ({
  resource: { collection: 'sermons', id },
  metadata: { protocol: 1, generation: `g-${id}`, revision: 1, deleted: false },
  value: { userId, title: id, date, verse: '', thoughts: [], ...(sourceNoteIds ? { sourceNoteIds } : {}) },
});

it('reads this owner’s on-device sermons through the real engine while offline, without a server or legacy cache', async () => {
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'u1' }, loading: false } as never);
  const engine = membershipEngineHarness([
    snapshot('b', '2026-10-30', ['n1']),
    snapshot('a', '2026-10-30', ['n1', 'n2']),
    snapshot('latest', '2026-10-31', ['n1']),
    snapshot('unrelated', '2026-11-01', ['n2']),
    snapshot('unlinked', '2026-11-02'),
    snapshot('other-owner', '2026-11-03', ['n1'], 'u2'),
  ]);
  jest.mocked(createBrowserDataEngine).mockImplementation(() => {
    const browser = engine.createBrowser();
    browser.engine.setOnline(false);
    return browser;
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  const { result, unmount } = renderHook(() => useSermonsBuiltOnNote('n1'), { wrapper });

  await waitFor(() => expect(result.current.sermons.map(sermon => sermon.id)).toEqual(['latest', 'a', 'b']));
  expect(result.current.loading).toBe(false);
  expect(engine.collectionTransport.list).not.toHaveBeenCalled();
  expect(engine.collectionTransport.changes).not.toHaveBeenCalled();
  expect(engine.transport.read).not.toHaveBeenCalled();

  await act(async () => { unmount(); });
});
