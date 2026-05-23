import { updateStudyNote } from '@/services/studies.service';

describe('studies.service', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'note-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses keepalive for study note updates so lifecycle flushes can complete best-effort', async () => {
    await updateStudyNote('note-1', { userId: 'user-1', title: 'Updated' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/studies/notes/note-1?userId=user-1'),
      expect.objectContaining({
        method: 'PUT',
        keepalive: true,
      })
    );
  });
});
