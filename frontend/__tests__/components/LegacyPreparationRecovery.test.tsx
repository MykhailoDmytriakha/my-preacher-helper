import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { LegacyPreparationRecovery } from '@/components/sermon/LegacyPreparationRecovery';
import { useRemotePeek } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/react.client', () => ({
  useRemotePeek: jest.fn(),
  discoverLegacyRecovery: jest.requireActual('@/data-engine/legacyRecovery.client').discoverLegacyRecovery,
}));
jest.mock('@/hooks/useClipboard', () => ({ useClipboard: jest.fn() }));
let mockOnline = true;
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

const key = 'draft:v1:owner:sermon:preparation';
const raw = JSON.stringify({ value: { authorIntent: 'Earlier unsaved words' }, savedAt: 10 }, null, 3);
const snapshot: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' }, value: { userId: 'owner', preparation: { authorIntent: 'Current words' } }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
const peek = jest.fn();
const copy = jest.fn();
const notice = () => screen.getByRole('region', { name: 'legacyPreparation.title' });
const renderRecovery = (owner: string | null = 'owner', confirmed: ResourceSnapshot | null = snapshot) =>
  render(<LegacyPreparationRecovery owner={owner} confirmed={confirmed} />);

describe('legacy preparation recovery controls', () => {
  beforeEach(() => {
    mockOnline = true;
    localStorage.clear(); localStorage.setItem(key, raw);
    peek.mockReset(); peek.mockRejectedValue(new Error('Offline'));
    copy.mockReset(); copy.mockResolvedValue(true);
    jest.mocked(useRemotePeek).mockReturnValue(peek);
    jest.mocked(useClipboard).mockReturnValue({ copyToClipboard: copy, isCopied: false, isLoading: false, error: null, reset: jest.fn() });
  });

  it('shows and copies the old words without replacing current preparation, including offline', async () => {
    renderRecovery();
    const region = await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(region).getByText('legacyRecovery.preview'));
    expect(within(region).getByText('Earlier unsaved words', { exact: false })).toBeVisible();
    fireEvent.click(within(region).getByRole('button', { name: 'legacyPreparation.copyText' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('Earlier unsaved words')));
    expect(localStorage.getItem(key)).toBe(raw);
    expect(snapshot.value?.preparation).toEqual({ authorIntent: 'Current words' });
    expect(useRemotePeek).toHaveBeenCalledWith({ fresh: true });
  });

  it('copies plan words without structural identities and keeps the exact historical original', async () => {
    const original = JSON.stringify({ value: { exegeticalPlan: [{ id: 'private-root-uuid', title: 'My first point',
      children: [{ id: 'private-child-uuid', title: 'My child point' }] }],
      homileticPlan: { sermonPlan: [{ id: 'private-sermon-uuid', title: 'My sermon point' }] } }, savedAt: 10 }, null, 3);
    localStorage.setItem(key, original);
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.copyText' }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    const text = copy.mock.calls[0][0] as string;
    for (const word of ['My first point', 'My child point', 'My sermon point']) expect(text).toContain(word);
    expect(text).not.toContain('private-root-uuid'); expect(text).not.toContain('private-child-uuid');
    expect(text).not.toContain('private-sermon-uuid');
    expect(localStorage.getItem(key)).toBe(original);
    expect(snapshot.value?.preparation).toEqual({ authorIntent: 'Current words' });
  });

  it('does not ask the server again when the editor re-emits the same confirmed version while typing', async () => {
    const view = renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 5; index += 1) {
      view.rerender(<LegacyPreparationRecovery owner="owner" confirmed={JSON.parse(JSON.stringify(snapshot)) as ResourceSnapshot} />);
    }
    await act(async () => { await Promise.resolve(); });
    expect(peek).toHaveBeenCalledTimes(1);
  });

  it('rechecks retained originals when the existing connectivity signal recovers', async () => {
    mockOnline = false;
    const view = renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(key)).toBe(raw);
    peek.mockResolvedValue({ ...snapshot, value: { userId: 'owner', preparation: { authorIntent: 'Earlier unsaved words' } } });
    mockOnline = true;
    view.rerender(<LegacyPreparationRecovery owner="owner" confirmed={snapshot} />);
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(peek).toHaveBeenCalledTimes(2);
  });

  it('downloads exact original bytes and leaves the original on the device', async () => {
    let exported: Blob | undefined;
    const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn() });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });
    const create = jest.spyOn(URL, 'createObjectURL').mockImplementation(value => { exported = value as Blob; return 'blob:qa-preparation'; });
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
      fireEvent.click(within(notice()).getByRole('button', { name: 'legacyRecovery.export' }));
      expect(exported).toBeDefined();
      const content = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(exported!); });
      expect(content).toBe(raw);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:qa-preparation');
      expect(localStorage.getItem(key)).toBe(raw);
    } finally {
      create.mockRestore(); revoke.mockRestore(); click.mockRestore();
      if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('keeps the copy when deletion is cancelled and removes only after explicit confirmation', async () => {
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.discard' }));
    let dialog = await screen.findByRole('dialog');
    expect(localStorage.getItem(key)).toBe(raw);
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(key)).toBe(raw);
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.discard' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
  });

  it('keeps a newer copy that replaces the record while its deletion question is open', async () => {
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(notice()).getByText('legacyRecovery.preview'));
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.discard' }));
    const dialog = await screen.findByRole('dialog');
    const replacement = JSON.stringify({ value: { authorIntent: 'Replacement words' }, savedAt: 20 });
    localStorage.setItem(key, replacement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(within(notice()).getByText('Replacement words', { exact: false })).toBeVisible());
    expect(localStorage.getItem(key)).toBe(replacement);
  });

  it('does not retire an echo after the route changed during the fresh read', async () => {
    let resolve!: (value: ResourceSnapshot) => void;
    peek.mockReturnValue(new Promise<ResourceSnapshot>(yes => { resolve = yes; }));
    const view = renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    view.rerender(<LegacyPreparationRecovery owner="owner" confirmed={{ ...snapshot, resource: { collection: 'sermons', id: 'other' } }} />);
    await act(async () => { resolve({ ...snapshot, value: { userId: 'owner', preparation: { authorIntent: 'Earlier unsaved words' } } }); });
    expect(localStorage.getItem(key)).toBe(raw);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('hides old content at once and withdraws its question when the account changes', async () => {
    const view = renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.discard' }));
    await screen.findByRole('dialog');
    view.rerender(<LegacyPreparationRecovery owner="other" confirmed={snapshot} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it.each([
    { ...snapshot, value: null, metadata: { ...snapshot.metadata!, deleted: true } },
    { ...snapshot, value: { userId: 'other', preparation: { authorIntent: 'Earlier unsaved words' } } },
    { ...snapshot, resource: { collection: 'sermons', id: 'other' }, value: { userId: 'owner', preparation: { authorIntent: 'Earlier unsaved words' } } },
  ])('keeps originals when a remote answer cannot prove a matching owned live preparation', async remote => {
    peek.mockResolvedValue(remote);
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    await waitFor(() => expect(peek).toHaveBeenCalled());
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('retires a fresh echo while a replacement arriving during the read stays visible', async () => {
    let resolve!: (value: ResourceSnapshot) => void;
    peek.mockReturnValue(new Promise<ResourceSnapshot>(yes => { resolve = yes; }));
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    const replacement = JSON.stringify({ value: { authorIntent: 'Newest words' }, savedAt: 30 });
    localStorage.setItem(key, replacement);
    await act(async () => { resolve({ ...snapshot, value: { userId: 'owner', preparation: { authorIntent: 'Earlier unsaved words' } } }); });
    expect(localStorage.getItem(key)).toBe(replacement);
    expect(within(notice()).getByText('Newest words', { exact: false })).toBeInTheDocument();
  });

  it('reports a failed copy while preserving the stored original', async () => {
    copy.mockResolvedValue(false);
    renderRecovery(); await screen.findByRole('region', { name: 'legacyPreparation.title' });
    fireEvent.click(within(notice()).getByRole('button', { name: 'legacyPreparation.copyText' }));
    await screen.findByRole('alert');
    expect(localStorage.getItem(key)).toBe(raw);
  });
});
