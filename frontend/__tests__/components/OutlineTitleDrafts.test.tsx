import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { OutlineTitleDraftNotices, OutlineTitleDraftScope, outlineTitleDraftResource, useOutlineTitleDraft } from '@/components/plan-editor/OutlineTitleDrafts';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';
import { createOutlineTitleDraftStore } from '@/data-engine/outlineTitleDrafts.client';
import { useOutlineTitleDraftSession } from '@/data-engine/react.client';
import { OutlineCollisionError } from '@/services/sermons.client';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useOutlineTitleDraftSession: jest.fn(),
}));

const target = { kind: 'point', id: 'point' } as const;
const owner = 'outline-test-owner';
const resource = outlineTitleDraftResource('sermons', 'outline-test-resource');
const heading = 'structure.unsubmittedTitle.heading';

function Editor({ write }: { write: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('Opening');
  const draft = useOutlineTitleDraft(open ? target.id : null);
  if (!open) return <button type="button" onClick={() => {
    draft.open({ target, text: 'Opening' }, 'Opening');
    setOpen(true);
  }}>Open editor</button>;
  return <input aria-label="Title input" value={text} onChange={event => {
    draft.change(event.target.value);
    setText(event.target.value);
  }} onKeyDown={event => {
    if (event.key !== 'Enter') return;
    draft.handoff(write());
    setOpen(false);
  }} />;
}

const scope = (write?: () => Promise<unknown>) => <OutlineTitleDraftScope owner={owner} resource={resource}>
  <OutlineTitleDraftNotices />
  {write && <Editor write={write} />}
</OutlineTitleDraftScope>;

beforeEach(() => {
  localStorage.clear();
  installStorageHarness();
  jest.mocked(useOutlineTitleDraftSession).mockReturnValue(createOutlineTitleDraftStore().forDocument(owner, resource));
});

it('does not discard a newer copy with the same words from an older screen', async () => {
  const first = render(scope(async () => undefined));
  fireEvent.click(within(first.container).getByRole('button', { name: 'Open editor' }));
  const input = within(first.container).getByRole('textbox', { name: 'Title input' });
  fireEvent.change(input, { target: { value: 'First title' } });
  const second = render(scope());
  const notice = within(second.container).getByRole('region', { name: heading });
  expect(within(notice).getByDisplayValue('First title')).toBeVisible();
  fireEvent.click(within(notice).getByRole('button', { name: 'structure.unsubmittedTitle.discard' }));
  fireEvent.change(input, { target: { value: 'Second title' } });
  fireEvent.change(input, { target: { value: 'First title' } });
  fireEvent.click(within(notice).getByRole('button', { name: 'unsavedDraft.discard' }));
  expect(await within(notice).findByDisplayValue('First title')).toBeVisible();
  first.unmount();
  second.unmount();
  render(scope());
  expect(await screen.findByDisplayValue('First title')).toBeVisible();
});

it('removes a discarded draft from another open view of the same sermon', async () => {
  const first = render(scope(async () => undefined));
  fireEvent.click(within(first.container).getByRole('button', { name: 'Open editor' }));
  fireEvent.change(within(first.container).getByRole('textbox', { name: 'Title input' }), { target: { value: 'Draft to discard' } });
  const second = render(scope());
  const third = render(scope());
  const from = within(second.container);
  const other = within(third.container);
  expect(await other.findByDisplayValue('Draft to discard')).toBeVisible();
  fireEvent.click(await from.findByRole('button', { name: 'structure.unsubmittedTitle.discard' }));
  fireEvent.click(from.getByRole('button', { name: 'unsavedDraft.discard' }));
  await waitFor(() => expect(from.queryByDisplayValue('Draft to discard')).not.toBeInTheDocument());
  expect(other.queryByDisplayValue('Draft to discard')).not.toBeInTheDocument();
});

it.each([true, false])('retires the copy only when the exact words were durably handed off (retained: %s)', async retained => {
  const refusal = new OutlineCollisionError([target.id], null, 0);
  if (retained) refusal.retainedTitle = { target, text: 'My new title' };
  const view = render(scope(async () => { throw refusal; }));
  fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
  const input = screen.getByRole('textbox', { name: 'Title input' });
  fireEvent.change(input, { target: { value: 'my new title' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  if (retained) await waitFor(() => expect(screen.queryByDisplayValue('my new title')).not.toBeInTheDocument());
  else expect(await screen.findByDisplayValue('my new title')).toBeVisible();
  view.unmount();
  render(scope());
  if (retained) expect(screen.queryByDisplayValue('my new title')).not.toBeInTheDocument();
  else expect(await screen.findByDisplayValue('my new title')).toBeVisible();
});
