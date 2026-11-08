import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { sortItemsWithAI } from '@/services/sortAI.service';
import { documentEngineHarness } from '@test-utils/documentEngineHarness';
import { TestProviders } from '@test-utils/test-providers';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon' }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub() }));
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: () => ({
  captureAcceptance: () => async () => undefined, accept: async () => undefined, discard: async () => undefined,
}) }));
jest.mock('@/components/thought/ThoughtTextHeader', () => ({ ThoughtTextHeader: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Thought text" value={value} onChange={event => onChange(event.target.value)} />
  ),
}));
let mockFocus = false;
jest.mock('@/services/sortAI.service');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockFocus ? 'mode=focus&section=main' : ''),
  usePathname: () => '/sermons/sermon/structure',
}));
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => null }));

const original = 'Stored thought words';
const draft = 'Words from the refused save';
const thought = { id: 'thought', text: original, tags: ['main'], date: '2026-11-07' };
const structure = { introduction: [], main: [thought.id], conclusion: [], ambiguous: [] };
const resource = { collection: 'sermons', id: 'sermon' };

it.each(['edit', 'create'])('keeps the saved board after discarding a refused thought %s', async mode => {
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure,
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  render(<TestProviders><DataEngineProvider><StructurePage /></DataEngineProvider></TestProviders>);
  expect(await screen.findByText(original)).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(mode === 'edit' ? 'structure.editThought' : 'structure.addThoughtToPoint'));
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: draft } });
  const dialog = screen.getByRole('dialog');
  if (mode === 'create') expect(within(dialog).getByLabelText('editThought.outlinePointLabel')).toHaveTextContent('Main point');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save).toBeEnabled());
  let refused = false;
  harness.storage.writeFailureFor = (key, value) => {
    if (refused || !Array.isArray(key) || !['checkpoint', 'request'].includes(key[0]) || !JSON.stringify(value)?.includes(draft)) return false;
    refused = true;
    return true;
  };
  fireEvent.click(save);
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  expect(refused).toBe(true);
  expect(editor).toHaveValue(draft);
  const cancel = within(dialog).getByRole('button', { name: 'buttons.cancel' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.server).toMatchObject({ metadata: { revision: 1 }, value: { thoughts: [thought] } });
  expect(screen.queryByText(draft)).not.toBeInTheDocument();
  expect(screen.getByText(original)).toBeVisible();
});

afterEach(() => { mockFocus = false; });

it.each(['edit', 'create'])('shows a captured manual %s while the board still displays sorting proposals', async mode => {
  mockFocus = true;
  const first = { ...thought, outlinePointId: 'point' };
  const second = { ...first, id: 'second', text: 'Second thought' };
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [first, second],
      structure: { ...structure, main: [first.id, second.id] },
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  jest.mocked(sortItemsWithAI).mockImplementation(async (_section, items) => [...items].reverse());
  render(<TestProviders><DataEngineProvider><StructurePage /></DataEngineProvider></TestProviders>);
  await screen.findByText(original);
  fireEvent.click(screen.getByTitle('structure.aiSortPoint'));
  await waitFor(() => expect(screen.getAllByTitle('structure.keepChanges')).toHaveLength(2));
  if (mode === 'edit') {
    const card = screen.getByText(original).closest<HTMLElement>('[aria-roledescription="sortable"]');
    if (!card) throw new Error('The thought is not on a sortable card');
    fireEvent.click(within(card).getByTitle('structure.editThought'));
  } else {
    fireEvent.click(screen.getByTitle('structure.addThoughtToPoint'));
  }
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: 'Manually revised thought' } });
  const dialog = screen.getByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(harness.server.value?.thoughts).toContainEqual(expect.objectContaining({
    text: 'Manually revised thought', outlinePointId: 'point',
  })));
  expect(screen.getByText('Manually revised thought')).toBeVisible();
  expect(screen.getAllByTitle('structure.keepChanges')).toHaveLength(2);
  expect(harness.server.value?.structure).toMatchObject({
    main: mode === 'edit' ? [first.id, second.id] : [first.id, second.id, expect.any(String)],
  });
  fireEvent.click(screen.getByRole('button', { name: 'structure.rejectAllChanges' }));
  await waitFor(() => expect(screen.queryByTitle('structure.keepChanges')).not.toBeInTheDocument());
  expect(screen.getByText('Manually revised thought')).toBeVisible();
  expect(harness.server.value?.thoughts).toContainEqual(expect.objectContaining({ text: 'Manually revised thought' }));
});
