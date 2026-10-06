import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CouncilDetailPage from '@/(pages)/(private)/care/council/[id]/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), isCollectionOnEngine: () => true }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => ({ councils: [], loading: false, error: null, refresh: jest.fn() }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'councils', id: 'council-1' };
const topic = { id: 'topic-1', title: 'Bring all notes', summary: 'Prepared', questions: [], options: [] };
/** A council written before the counter existed (BUG-20261004-council-without-rev-refuses-title). */
const revless: ResourceSnapshot = {
  resource,
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Original council', status: 'preparing', date: '2026-09-27', topics: [topic],
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
};

const settle = async () => { await act(async () => { await settleEngine(); }); };

it('delivers a new title for a council written before it had a version counter', async () => {
  const harness = documentEngineHarness(revless);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const Workspace = ({ active = true }: { active?: boolean }) => <DataEngineProvider>{active && <CouncilDetailPage />}</DataEngineProvider>;
  const view = render(<Workspace />);
  await screen.findByDisplayValue('Original council');
  await settle();

  fireEvent.change(screen.getByDisplayValue('Original council'), { target: { value: 'Renamed old council' } });
  await settle();
  view.rerender(<Workspace active={false} />);
  await settle();

  await waitFor(() => expect(harness.server.value?.title).toBe('Renamed old council'));
  expect(harness.server.value?.rev).toBe(1);
  view.unmount();
});
