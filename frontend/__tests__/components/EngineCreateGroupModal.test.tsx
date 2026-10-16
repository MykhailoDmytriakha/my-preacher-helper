import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EngineCreateGroupModal } from '@/components/groups/EngineCreateGroupModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('react-day-picker/dist/style.css', () => ({}));
const resource = { collection: 'groups', id: 'new-group' };
function setup() {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn(), onQueued = jest.fn();
  function Workspace({ recoveryId }: { recoveryId?: string }) {
    return <DataEngineProvider><EngineCreateGroupModal groupId={resource.id} recoveryId={recoveryId} onClose={onClose} onQueued={onQueued} /></DataEngineProvider>;
  }
  return { harness, Workspace, view: render(<Workspace />), onQueued, onClose };
}
beforeEach(() => jest.clearAllMocks());
it('keeps typing local, preserves it across restart, and only submits on Create', async () => {
  const { harness, Workspace, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.groups.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Unsent creation' } });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  const choices = await harness.checkpoints.listRecoverable('owner', resource);
  expect(choices).toEqual(expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({
    checkpoint: expect.objectContaining({ draft: expect.objectContaining({ title: 'Unsent creation' }) }),
  }) })]));
  const recoveryId = choices.find(item => item.record.checkpoint.draft?.title === 'Unsent creation')!.id;
  view.unmount();
  const restored = render(<Workspace recoveryId={recoveryId} />);
  const input = await screen.findByDisplayValue('Unsent creation');
  await waitFor(() => expect(input).toBeEnabled());
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith('new-group'));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ userId: 'owner', title: 'Unsent creation', templates: expect.any(Array), flow: expect.any(Array) });
  expect(harness.server.value?.templates).toHaveLength(3);
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  restored.unmount();
});
it('takes durable ownership offline without claiming a server save', async () => {
  const { harness, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.groups.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  act(() => harness.engine.setOnline(false));
  fireEvent.change(title, { target: { value: 'Offline creation' } });
  fireEvent.submit(title.closest('form')!);
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith('new-group'));
  expect(harness.server.value).toBeNull();
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect((await harness.commits.list('owner')).some(commit => commit.value?.title === 'Offline creation')).toBe(true);
  view.unmount();
});

it('keeps the same first meeting when the creation date is cleared', async () => {
  const { harness, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.groups.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Prepared without a date' } });
  const date = screen.getAllByRole('textbox')[2];
  fireEvent.change(date, { target: { value: '2026-11-19' } });
  await act(async () => { await settleEngine(); });
  const draft = (await harness.checkpoints.listRecoverable('owner', resource))[0].record.checkpoint.draft!;
  const first = (draft.meetingDates as any[])[0];
  fireEvent.change(date, { target: { value: '' } });
  fireEvent.submit(title.closest('form')!);
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith('new-group'));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value?.meetingDates).toEqual([{ ...first, date: '' }]);
  view.unmount();
});

it('does not submit unfinished creation-date text even when native validation is bypassed', async () => {
  const { harness, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.groups.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Unfinished day' } });
  fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: '2026-0' } });
  fireEvent.submit(title.closest('form')!);
  await act(async () => { await settleEngine(); });
  expect(onQueued).not.toHaveBeenCalled();
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('2026-0')).toBeInTheDocument();
  view.unmount();
});

describe('deleteGuard recoverable draft behavior', () => {
  it('keeps a typed group draft discoverable after the person closes the form', async () => {
    const { harness, view, onClose } = setup();
    const title = await screen.findByPlaceholderText('workspaces.groups.form.titlePlaceholder');
    await waitFor(() => expect(title).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Recoverable group words' } });
    await act(async () => { await settleEngine(); });

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();

    const choices = await harness.checkpoints.listRecoverable('owner', resource);
    expect(choices).toEqual(expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({
      checkpoint: expect.objectContaining({ draft: expect.objectContaining({ title: 'Recoverable group words' }) }),
    }) })]));
    expect(screen.queryByRole('dialog', { name: 'common.discardChanges.title' })).not.toBeInTheDocument();
  });
});
