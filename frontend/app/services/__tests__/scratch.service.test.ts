import { composePlanFromScratch } from '@/services/scratch.service';

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: {
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
    expect(result.introduction[0]).toEqual(
      expect.objectContaining({
        scratchNoteId: 'n1',
        text: 'Intro point',
      })
    );
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
