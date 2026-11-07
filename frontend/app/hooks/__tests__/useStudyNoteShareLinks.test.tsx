import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useDataCollection, useShareCapabilityActions } from '@/data-engine/react.client';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerUnavailableNotice } from '@/hooks/useServerUnavailableNotice';
import { createStudyNoteShareLink, deleteStudyNoteShareLink, getStudyNoteShareLinks } from '@services/studyNoteShareLinks.service';

import { useStudyNoteShareLinks } from '../useStudyNoteShareLinks';

import type { AppLocale } from '@/utils/appLocale';
import type { StudyNoteShareLink } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useShareCapabilityActions: jest.fn(),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: jest.fn() }));
jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: jest.fn() }));
jest.mock('@/hooks/useServerUnavailableNotice', () => ({ useServerUnavailableNotice: jest.fn() }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@services/studyNoteShareLinks.service', () => ({
  getStudyNoteShareLinks: jest.fn(), createStudyNoteShareLink: jest.fn(), deleteStudyNoteShareLink: jest.fn(),
}));

const mockUseDataCollection = useDataCollection as jest.Mock;
const mockUseCapability = useShareCapabilityActions as jest.Mock;
const mockUseUid = useResolvedUid as jest.Mock;
const mockUseLocale = useAppLocale as jest.Mock;
const mockUseServerNotice = useServerUnavailableNotice as jest.Mock;
const mockGetLinks = getStudyNoteShareLinks as jest.Mock;
const mockCreateLegacy = createStudyNoteShareLink as jest.Mock;
const mockDeleteLegacy = deleteStudyNoteShareLink as jest.Mock;

type Action = { id: string; kind: 'create' | 'revoke'; targetId: string; code?: string; state: 'pending' | 'refused' | 'conflict' | 'unknown' };
type Capability = {
  ready: boolean;
  actions: Action[];
  create: jest.Mock<Promise<void>, [string, AppLocale, unknown?, string?]>;
  revoke: jest.Mock<Promise<void>, [string]>;
  retry: jest.Mock<Promise<void>, [string]>;
};
const makeCapability = (overrides: Partial<Capability> = {}): Capability => ({
  ready: true, actions: [],
  create: jest.fn<Promise<void>, [string, AppLocale, unknown?, string?]>().mockResolvedValue(undefined),
  revoke: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  retry: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined), ...overrides,
});
let capability: Capability;
let uid: string | undefined;
let authLoading: boolean;
let linkRows: Array<{ resource: { collection: string; id: string }; value: Partial<StudyNoteShareLink> }>;
let retiredNotes = new Set<string>();
const observedNote = (id: string) => ({ resource: { collection: 'studyNotes', id }, value: { userId: 'owner' },
  metadata: { protocol: 1, generation: 'note-generation', revision: 2, deleted: false, shareRevocation: 'revoke' } });
const refresh = jest.fn(async () => undefined);

const makeLink = (id: string, noteId: string, ownerId = 'owner'): StudyNoteShareLink => ({
  id, ownerId, noteId, token: `token-${id}`, createdAt: '2026-10-29T00:00:00.000Z', viewCount: 0,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  uid = 'owner'; authLoading = false; retiredNotes = new Set(); linkRows = [];
  capability = makeCapability();
  mockUseUid.mockImplementation(() => ({ uid, isAuthLoading: authLoading }));
  mockUseLocale.mockReturnValue({ locale: 'ru' });
  mockUseServerNotice.mockReturnValue(false);
  mockUseCapability.mockImplementation(() => capability);
  mockUseDataCollection.mockImplementation((collection: string | null) => {
    if (collection === 'studyNoteShareLinks') return {
      state: { documents: linkRows, snapshots: [] }, loading: false, error: null, refresh,
    };
    if (collection === 'studyNotes') return {
      presence: (id: string) => retiredNotes.has(id) ? { snapshot: { metadata: { deleted: true } } } : { kind: 'present', snapshot: observedNote(id) },
    };
    return { state: null, loading: false, error: null, refresh, presence: () => ({ snapshot: null }) };
  });
});

afterEach(() => { window.localStorage.clear(); });

describe('useStudyNoteShareLinks', () => {
  it('keeps loading while identity is loading and does not subscribe to owner collections', () => {
    uid = undefined; authLoading = true;
    const { result } = renderHook(() => useStudyNoteShareLinks());
    expect(result.current.uid).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(mockUseDataCollection).toHaveBeenCalledWith(null);
  });

  it('returns only the current owner’s valid links and converts collection rows to DTOs', () => {
    linkRows = [
      { resource: { collection: 'studyNoteShareLinks', id: 'row-link-1' }, value: { ...makeLink('wrong-value-id', 'note-1'), id: 'ignored' } },
      { resource: { collection: 'studyNoteShareLinks', id: 'other-owner-link' }, value: makeLink('other', 'note-2', 'someone-else') },
      { resource: { collection: 'studyNoteShareLinks', id: 'retired-link' }, value: makeLink('retired', 'note-3') },
      { resource: { collection: 'studyNoteShareLinks', id: 'malformed-link' }, value: { ownerId: 'owner', noteId: 'note-4' } },
    ];
    retiredNotes.add('note-3');
    const { result } = renderHook(() => useStudyNoteShareLinks());
    expect(result.current.shareLinks).toEqual([{ ...makeLink('wrong-value-id', 'note-1'), id: 'row-link-1' }]);
  });

  it('captures create and revoke through the public facade with the selected locale and target IDs', async () => {
    const { result } = renderHook(() => useStudyNoteShareLinks());
    await act(async () => { await result.current.createShareLink('note-1'); });
    await act(async () => { await result.current.deleteShareLink('link-9'); });
    expect(capability.create).toHaveBeenCalledTimes(1);
    expect(capability.create).toHaveBeenCalledWith('note-1', 'ru', observedNote('note-1'), undefined);
    expect(capability.revoke).toHaveBeenCalledTimes(1);
    expect(capability.revoke).toHaveBeenCalledWith('link-9');
    expect(mockCreateLegacy).not.toHaveBeenCalled();
    expect(mockDeleteLegacy).not.toHaveBeenCalled();
    expect(mockGetLinks).not.toHaveBeenCalled();
  });

  it('does not capture duplicate in-flight or already queued local actions', async () => {
    const pending = deferred<void>();
    capability.create.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(() => useStudyNoteShareLinks());
    let first!: Promise<void>;
    act(() => { first = result.current.createShareLink('note-1'); });
    await act(async () => { await result.current.createShareLink('note-1'); });
    expect(capability.create).toHaveBeenCalledTimes(1);
    pending.resolve(); await act(async () => { await first; });

    capability = makeCapability({ actions: [{ id: 'op-queued', kind: 'create', targetId: 'note-2', state: 'pending' }] });
    rerender();
    await act(async () => { await result.current.createShareLink('note-2'); });
    expect(capability.create).not.toHaveBeenCalled();
  });

  it('does not show an unresolved warning while the shared engine notice owns unknown delivery', async () => {
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    mockUseServerNotice.mockReturnValue(true);
    capability = makeCapability({ actions: [{ id: 'operation-unknown', kind: 'create', targetId: 'note-1', state: 'unknown' }] });
    renderHook(() => useStudyNoteShareLinks());
    await act(async () => { await Promise.resolve(); });
    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

  it('reports one local capture rejection and propagates the error', async () => {
    const error = new Error('capture unavailable');
    capability.create.mockRejectedValue(error);
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    const { result } = renderHook(() => useStudyNoteShareLinks());
    await act(async () => { await expect(result.current.createShareLink('note-7')).rejects.toBe(error); });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('studiesWorkspace.shareLinks.createUnconfirmed', { id: 'share-capability-capture:["owner","create","note-7"]' });
    toastError.mockRestore();
  });

  it.each(['refused', 'unknown'] as const)('restores owner-scoped %s recovery and retries the exact durable action ID', async state => {
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    capability = makeCapability({ actions: [{ id: 'operation-42', kind: 'revoke', targetId: 'link-1', state }] });
    const { unmount } = renderHook(() => useStudyNoteShareLinks());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'studiesWorkspace.shareLinks.revokeUnconfirmed', expect.objectContaining({ id: 'share-capability:owner:operation-42' }),
    ));
    unmount();
    capability = makeCapability({ actions: [{ id: 'operation-42', kind: 'revoke', targetId: 'link-1', state }] });
    const second = renderHook(() => useStudyNoteShareLinks());
    await act(async () => {
      const options = toastError.mock.calls.at(-1)?.[1] as { action?: { onClick?: () => void } } | undefined;
      options?.action?.onClick?.();
    });
    await waitFor(() => expect(capability.retry).toHaveBeenCalledWith('operation-42'));
    expect(toastError.mock.calls.some(([, options]) => (options as { id?: string } | undefined)?.id === 'share-capability:other-owner:operation-42')).toBe(false);
    second.unmount(); toastError.mockRestore();
  });

  it('dismisses durable recovery on acknowledgement and owner change', async () => {
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    const toastDismiss = jest.spyOn(toast, 'dismiss').mockImplementation(() => '');
    capability = makeCapability({ actions: [{ id: 'operation-43', kind: 'create', targetId: 'note-1', state: 'refused' }] });
    const { rerender } = renderHook(() => useStudyNoteShareLinks());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    capability = makeCapability();
    rerender();
    await waitFor(() => expect(toastDismiss).toHaveBeenCalledWith('share-capability:owner:operation-43'));

    capability = makeCapability({ actions: [{ id: 'operation-44', kind: 'revoke', targetId: 'link-1', state: 'refused' }] });
    rerender();
    await waitFor(() => expect(toastError.mock.calls.some(([, options]) => (options as { id?: string } | undefined)?.id === 'share-capability:owner:operation-44')).toBe(true));
    uid = 'next-owner'; capability = makeCapability(); rerender();
    await waitFor(() => expect(toastDismiss).toHaveBeenCalledWith('share-capability:owner:operation-44'));
    expect(toastError.mock.calls.some(([, options]) => (options as { id?: string } | undefined)?.id === 'share-capability:next-owner:operation-44')).toBe(false);
    toastError.mockRestore(); toastDismiss.mockRestore();
  });
  it('requires a new create choice after a stale share request and sends the observed access version', async () => {
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    capability = makeCapability({ actions: [{ id: 'held-refusal', kind: 'create', targetId: 'note-1',
      state: 'refused', code: 'share-link-review-required' }] });
    const { result } = renderHook(() => useStudyNoteShareLinks());
    expect(toastError).toHaveBeenCalledWith('studiesWorkspace.shareLinks.createReviewRequired',
      { id: 'share-capability:owner:held-refusal', duration: Infinity });
    expect(capability.retry).not.toHaveBeenCalled();
    await act(async () => { await result.current.createShareLink('note-1'); });
    expect(capability.create).toHaveBeenCalledWith('note-1', 'ru', observedNote('note-1'), 'held-refusal');
    expect(capability.retry).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

  it.each(['create', 'revoke'] as const)('recovers the exact refused %s action when its ordinary button is pressed again', async kind => {
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => '');
    capability = makeCapability({ actions: [{ id: 'held-refusal', kind, targetId: 'same-target', state: 'refused' }] });
    const { result } = renderHook(() => useStudyNoteShareLinks());
    await act(async () => {
      await (kind === 'create' ? result.current.createShareLink('same-target') : result.current.deleteShareLink('same-target'));
    });
    expect(capability.retry).toHaveBeenCalledWith('held-refusal');
    expect(capability.create).not.toHaveBeenCalled();
    expect(capability.revoke).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

});
