import { composePlanFromScratch } from '@/services/scratch.service';

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: {
      uid: 'scratch-test-owner',
      getIdToken: jest.fn().mockResolvedValue('token-123'),
    },
  },
}));

jest.mock('@/services/sermons.client', () => ({
  addScratchNoteViaClient: jest.fn(),
  updateScratchNoteViaClient: jest.fn(),
  deleteScratchNoteViaClient: jest.fn(),
}));

jest.mock('@/utils/apiClient', () => ({
  apiClient: jest.fn(),
}));

const apiClientMock = () =>
  (jest.requireMock('@/utils/apiClient') as { apiClient: jest.Mock }).apiClient;

describe('scratch.service', () => {
  const emptyOutline = { introduction: [], main: [], conclusion: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  describe('the phone flag says offline (BUG-20261011-raw-phone-flag-in-read-paths)', () => {
    const connectivity = () => jest.requireActual('@/utils/connectivity') as typeof import('@/utils/connectivity');
    beforeEach(() => {
      connectivity().__resetConnectivityForTests();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    });
    afterEach(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      connectivity().__resetConnectivityForTests();
      // A refused call leaves its queued answer unspent; it must not reach the next test.
      apiClientMock().mockReset();
    });

    it('refuses at once while nothing has reached the server', async () => {
      await expect(composePlanFromScratch('sermon-1', emptyOutline, ['n1'])).rejects.toThrow('unavailable offline');
      expect(apiClientMock()).not.toHaveBeenCalled();
    });

    it('asks the server once a request has reached it, though the flag is stuck', async () => {
      connectivity().getConnectivityStatus();
      connectivity().reportServerReachable();
      apiClientMock().mockResolvedValueOnce({ ok: true, json: async () => ({ outline: emptyOutline }) });
      await composePlanFromScratch('sermon-1', emptyOutline, ['n1']);
      expect(apiClientMock()).toHaveBeenCalled();
    });
  });

  it('carries the status of a bare 504, so the screen can say compose ran out of time', async () => {
    apiClientMock().mockResolvedValueOnce({ ok: false, status: 504, statusText: 'Gateway Timeout', json: async () => { throw new Error('not JSON'); } });

    await expect(composePlanFromScratch('sermon-1', emptyOutline, ['n1'])).rejects.toMatchObject({ status: 504 });
  });

  it('reuses the same operation after a pending result and starts a new one after acknowledgment', async () => {
    const pending = { ok: false, status: 504, json: async () => ({ code: 'ai-result-pending', error: 'pending' }) };
    const success = { ok: true, json: async () => ({ outline: emptyOutline }) };
    apiClientMock().mockResolvedValueOnce(pending).mockResolvedValueOnce(success).mockResolvedValueOnce(success).mockResolvedValueOnce(success);
    const compose = (recoverOnly = false) => composePlanFromScratch('sermon-with-pending-result', emptyOutline, ['n1'], undefined, { recoverOnly });

    await expect(compose()).rejects.toMatchObject({ code: 'ai-result-pending', status: 504 });
    await compose(true); // The caller did not accept the response (for example, the view closed).
    const accepted = await compose(true);
    accepted.acknowledge();
    await compose();

    const headers = apiClientMock().mock.calls.map(([, options]) => options.headers);
    const ids = headers.map(header => header['X-AI-Operation-Id']);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(headers[1]['X-AI-Recover-Only']).toBe('1');
    expect(headers[3]['X-AI-Recover-Only']).toBeUndefined();
  });

  it('does not start a new operation in recovery-only mode', async () => {
    await expect(composePlanFromScratch('sermon-without-previous-attempt', emptyOutline, ['n1'], undefined, { recoverOnly: true }))
      .rejects.toMatchObject({ code: 'ai-result-unavailable' });
    expect(apiClientMock()).not.toHaveBeenCalled();
  });

  it('retains an uncertain attempt across an intermediate server error', async () => {
    const unexpected = { ok: false, status: 500, json: async () => ({ error: 'Unexpected store error' }) };
    const success = { ok: true, json: async () => ({ outline: emptyOutline }) };
    apiClientMock().mockResolvedValueOnce(unexpected).mockResolvedValueOnce(success);
    const compose = () => composePlanFromScratch('sermon-with-uncertain-result', emptyOutline, ['n1']);

    await expect(compose()).rejects.toMatchObject({ status: 500 });
    await compose();

    const ids = apiClientMock().mock.calls.map(([, options]) => options.headers['X-AI-Operation-Id']);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
  });

  it.each([
    [401, {}],
    [504, { code: 'deadline-exceeded' }],
  ])('keeps the paid result recoverable after a retry stops before opening its receipt (%s)', async (status, body) => {
    const success = { ok: true, json: async () => ({ outline: emptyOutline }) };
    apiClientMock()
      .mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({ code: 'ai-result-pending', error: 'pending' }) })
      .mockResolvedValueOnce({ ok: false, status, json: async () => ({ ...body, error: 'preflight failed' }) })
      .mockResolvedValueOnce(success);
    const compose = () => composePlanFromScratch('sermon-retry-preflight-'+status, emptyOutline, ['n1']);

    await expect(compose()).rejects.toMatchObject({ code: 'ai-result-pending' });
    await expect(compose()).rejects.toMatchObject({ status });
    (await compose()).acknowledge();

    const ids = apiClientMock().mock.calls.map(([, options]) => options.headers['X-AI-Operation-Id']);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids).toEqual([ids[0], ids[0], ids[0]]);
  });

  it('sends the current user bearer token when composing from scratch notes', async () => {
    apiClientMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        outline: {
          introduction: [
            {
              id: 'p1',
              scratchNoteId: 'n1',
              text: 'Intro point',
              source: 'ai',
            },
          ],
          main: [],
          conclusion: [],
        },
      }),
    });

    const result = await composePlanFromScratch('sermon-1', emptyOutline, ['n1']);

    expect(apiClientMock()).toHaveBeenCalledWith(
      expect.stringContaining('/api/sermons/sermon-1/compose-plan-from-scratch'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
        body: JSON.stringify({ existingOutline: emptyOutline, scratchNoteIds: ['n1'] }),
        category: 'ai',
      })
    );
    expect(result.outline.introduction[0]).toEqual(
      expect.objectContaining({
        scratchNoteId: 'n1',
        text: 'Intro point',
      })
    );
    expect(result.unplacedScratchNoteIds).toEqual([]);
  });

  it('surfaces the notes the model skipped instead of dropping that fact', async () => {
    apiClientMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        outline: {
          introduction: [],
          main: [
            { id: 'p1', scratchNoteId: 'n1', text: 'Placed', source: 'ai' },
            { id: 'p2', scratchNoteId: 'n2', text: 'Fallback point', source: 'ai' },
          ],
          conclusion: [],
        },
        unplacedScratchNoteIds: ['n2'],
      }),
    });

    const result = await composePlanFromScratch('sermon-1', emptyOutline, ['n1', 'n2']);

    expect(result.unplacedScratchNoteIds).toEqual(['n2']);
  });

  it('rejects composed outlines containing scratch ids the client did not request', async () => {
    apiClientMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        outline: {
          introduction: [],
          main: [
            {
              id: 'p-unknown',
              scratchNoteId: 'unknown-note',
              text: 'Unknown note point',
              source: 'ai',
            },
          ],
          conclusion: [],
        },
      }),
    });

    await expect(composePlanFromScratch('sermon-1', emptyOutline, ['known-note'])).rejects.toThrow(
      'Compose plan returned unknown scratch ids: unknown-note'
    );
  });
});

it('sends the frozen generation source without replacing it with a fresh read', async () => {
  const outline = { introduction: [], main: [], conclusion: [] };
  const source = { title: 'Pinned', verse: 'Romans 1', scratch: [{ id: 'n1', text: 'Pinned text', createdAt: 'today', section: null }] };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  apiClientMock().mockResolvedValue({ ok: true, json: async () => ({ outline }) });
  await composePlanFromScratch('sermon', outline, ['n1'], source);
  expect(JSON.parse(apiClientMock().mock.calls.at(-1)[1].body)).toEqual({ existingOutline: outline, scratchNoteIds: ['n1'], expectedSource: source });
});
