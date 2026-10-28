// The real react-markdown, not the global stub in jest.setup.js: a section's reference must become a link.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CouncilDetailPage from '@/(pages)/(private)/care/council/[id]/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }), usePathname: () => '/care/council/council-1', useSearchParams: () => new URLSearchParams() }));
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

// Case 2026-10-12-block-diagram, L8: a reference in a council's section opens its verse, as in a note or a group.
it('makes a reference in a section of the council a link to the verse', async () => {
  const withVerse: ResourceSnapshot = { ...revless, value: { ...revless.value as object, topics: [{ ...topic, summary: 'Прочитать Рим 8:28 вместе' }] } };
  const harness = documentEngineHarness(withVerse);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><CouncilDetailPage /></DataEngineProvider>);
  await screen.findByDisplayValue('Original council');
  await settle();
  await waitFor(() => expect(Array.from(view.container.querySelectorAll('[data-scripture-link]')).map((link) => link.textContent)).toContain('Рим 8:28'));
  view.unmount();
});

// Codex review 2026-10-27: the questions and answers were drawn as strings, and one line alone did not say the
// council's language.
it('links a reference in a question and its answer, read in the language of the whole council', async () => {
  const ukrainian: ResourceSnapshot = { ...revless, value: { ...revless.value as object, title: 'Братська рада: молитва і мудрість', topics: [{ ...topic, title: 'Мудрість', summary: 'Що каже Писання', questions: [{ id: 'q1', question: 'Як просити, як у 1Цар 3:9?', answer: 'Просити з вірою' }] }] } };
  const harness = documentEngineHarness(ukrainian);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><CouncilDetailPage /></DataEngineProvider>);
  await screen.findByDisplayValue('Братська рада: молитва і мудрість');
  await settle();
  await waitFor(() => expect(Array.from(view.container.querySelectorAll('[data-scripture-link]')).map((link) => link.textContent)).toContain('1Цар 3:9'));
  // Ohienko's 1 Kings under a Russian interface: the mark beside the link names its Bible.
  expect(view.container.querySelector('[data-scripture-bible]')).not.toBeNull();
  view.unmount();
});
