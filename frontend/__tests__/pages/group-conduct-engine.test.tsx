import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ConductPage from '@/(pages)/(private)/groups/[id]/conduct/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'group-1' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useGroupDetail', () => ({ useGroupDetail: () => { throw new Error('Legacy editor reached'); } }));
jest.mock('@/hooks/useConductTimer', () => ({ useConductTimer: () => ({ timeLeft: null, isOvertime: false }) }));
jest.mock('@/components/groups/conduct/ConductBlock', () => ({ __esModule: true, default: ({ flowItem }: { flowItem: { durationMin: number } }) => <div><span>Conducting now</span><span>Duration: {flowItem.durationMin}</span></div> }));
jest.mock('@/components/groups/conduct/ConductOverview', () => ({ __esModule: true, default: () => <div>Overview</div> }));

const flow = (durationMin = 5) => [{ id: 'block', templateId: 'template', order: 1, durationMin }];
const previous = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'groups'; });
afterEach(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previous; });
function setup() {
  const harness = documentEngineHarness({ resource: { collection: 'groups', id: 'group-1' },
    metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: {
      userId: 'owner', title: 'Meeting group', status: 'draft', createdAt: 'created', updatedAt: 'old', flow: flow(),
      templates: [{ id: 'template', type: 'notes', title: 'Reading', content: '', status: 'draft', createdAt: 'created', updatedAt: 'old' }],
    } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Workspace() { return <DataEngineProvider><ConductPage /></DataEngineProvider>; }
  return { harness, Workspace, view: render(<Workspace />) };
}
it('allows starting an unchanged setup without submitting a redundant write', async () => {
  const { harness, view } = setup();
  const start = await screen.findByRole('button', { name: /conduct.preflight.startButton/ });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  expect(await screen.findByText('Conducting now')).toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled();
  view.unmount();
});
it('keeps duration typing unsent and conflicts against the pinned opening value on Start', async () => {
  const { harness, view } = setup();
  const duration = await screen.findByDisplayValue('5');
  await waitFor(() => expect(duration).toBeEnabled());
  fireEvent.change(duration, { target: { value: '7' } });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  await act(async () => { await harness.remote({ flow: flow(20) }); });
  expect(duration).toHaveValue(7);
  fireEvent.click(screen.getByRole('button', { name: /conduct.preflight.startButton/ }));
  expect(await screen.findByText('Conducting now')).toBeInTheDocument();
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
  expect(harness.server.value?.flow).toEqual(flow(20));
  view.unmount();
});
it('offers an unfinished setup after restart without sending it automatically', async () => {
  const { harness, Workspace, view } = setup();
  const duration = await screen.findByDisplayValue('5');
  await waitFor(() => expect(duration).toBeEnabled());
  fireEvent.change(duration, { target: { value: '9' } });
  await act(async () => { await settleEngine(); });
  view.unmount();
  const reopened = render(<Workspace />);
  expect(await screen.findByDisplayValue('5')).toBeInTheDocument();
  const option = await screen.findByRole('option', { name: 'Meeting group' });
  fireEvent.change(option.closest('select')!, { target: { value: (option as HTMLOptionElement).value } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  expect(await screen.findByDisplayValue('9')).toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled();
  reopened.unmount();
});

it('starts with the final durable duration when Start precedes the React echo', async () => {
  const { harness, view } = setup();
  const duration = await screen.findByDisplayValue('5');
  const start = screen.getByRole('button', { name: /conduct.preflight.startButton/ });
  await waitFor(() => expect(start).toBeEnabled());
  act(() => {
    fireEvent.change(duration, { target: { value: '7' } });
    fireEvent.click(start);
  });
  expect(await screen.findByText('Duration: 7')).toBeInTheDocument();
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value?.flow).toEqual(flow(7));
  view.unmount();
});
