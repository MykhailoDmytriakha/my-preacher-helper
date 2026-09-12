import { createCouncil, deleteCouncil, saveCouncil } from '@/services/councils.service';

import type { Council } from '@/models/models';

const mockSetViaSdk = jest.fn();
const mockDeleteViaSdk = jest.fn();
const mockReplace = jest.fn();
const mockCreate = jest.fn();
const mockDeleteOnServer = jest.fn();

jest.mock('@/services/councils.client', () => ({
  setCouncilViaSdk: (...args: unknown[]) => mockSetViaSdk(...args),
  deleteCouncilViaSdk: (...args: unknown[]) => mockDeleteViaSdk(...args),
}));
jest.mock('@/services/councilsTransport.client', () => ({
  replaceCouncilOnServer: (...args: unknown[]) => mockReplace(...args),
  createCouncilOnServer: (...args: unknown[]) => mockCreate(...args),
  deleteCouncilOnServer: (...args: unknown[]) => mockDeleteOnServer(...args),
}));

const council: Council = {
  id: 'c1', userId: 'u1', title: 'Совет', status: 'preparing', topics: [], createdAt: 'T', updatedAt: 'T', rev: 2,
};

const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });

/**
 * WHICH ROAD A WRITE TAKES is the whole point of this module: online — the server over HTTPS,
 * never the SDK that holds a write for ever on the iPad; offline — the SDK's own queue.
 */
describe('council writes choose their road', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setOnline(true);
    mockSetViaSdk.mockResolvedValue(undefined);
    mockDeleteViaSdk.mockResolvedValue(undefined);
  });

  it('goes over HTTPS with the revision it was built on while online', async () => {
    mockReplace.mockResolvedValue({ conflict: false, current: { ...council, rev: 3 } });
    const result = await saveCouncil(council);
    expect(mockReplace).toHaveBeenCalledWith(council, 2, {});
    expect(result).toEqual({ kind: 'saved', council: { ...council, rev: 3 } });
    expect(mockSetViaSdk).not.toHaveBeenCalled();
  });

  it('hands a superseded base back as a conflict with the server\'s copy', async () => {
    const current = { ...council, title: 'другое', rev: 5 };
    mockReplace.mockResolvedValue({ conflict: true, current });
    expect(await saveCouncil(council)).toEqual({ kind: 'conflict', current });
  });

  it('reports a timeout as unknown and never replays it through the SDK', async () => {
    mockReplace.mockRejectedValue(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' }));
    expect(await saveCouncil(council)).toEqual({ kind: 'unknown' });
    expect(mockSetViaSdk).not.toHaveBeenCalled();
  });

  it('never re-creates a council the server knew and no longer has: a deleted one must not rise again', async () => {
    mockReplace.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not-found' }));
    expect(await saveCouncil(council, { knownToServer: true })).toEqual({ kind: 'gone' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a council the server never knew: one written on this device while offline', async () => {
    mockReplace.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not-found' }));
    mockCreate.mockResolvedValue({ ...council, rev: 0 });
    expect(await saveCouncil(council)).toEqual({ kind: 'saved', council: { ...council, rev: 0 } });
  });

  it('does not wait for the offline SDK, whose promise only settles when the server answers', async () => {
    setOnline(false);
    // Offline `setDoc` resolves on acknowledgement, which may be hours away — a save that waits
    // for it holds every later change behind it.
    mockSetViaSdk.mockImplementation(() => new Promise<void>(() => undefined));
    await expect(saveCouncil(council)).resolves.toEqual({ kind: 'queued' });
  });

  it('queues through the SDK while offline, for save, create and delete alike', async () => {
    setOnline(false);
    expect(await saveCouncil(council)).toEqual({ kind: 'queued' });
    expect(await createCouncil(council)).toEqual({ kind: 'queued' });
    expect(await deleteCouncil('c1')).toEqual({ kind: 'queued' });
    expect(mockSetViaSdk).toHaveBeenCalledTimes(2);
    expect(mockDeleteViaSdk).toHaveBeenCalledWith('c1');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('treats deleting what is already gone as done', async () => {
    mockDeleteOnServer.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not-found' }));
    expect((await deleteCouncil('c1')).kind).toBe('saved');
  });
});
