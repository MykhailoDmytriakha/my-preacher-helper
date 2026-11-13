import { getStudyNoteShareLinks } from '@/services/studyNoteShareLinks.service';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

let mockOwner: string | undefined = 'A';
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => mockOwner }));
jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ ...jest.requireActual('@/utils/authenticatedRequest'), getAuthenticatedRequestHeaders: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); mockOwner = 'A'; });

it('does not send an A read if identity changes while its auth headers are being obtained', async () => {
  let finish!: (headers: Record<string, string>) => void;
  jest.mocked(getAuthenticatedRequestHeaders).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  jest.mocked(apiClient).mockResolvedValue({ ok: true, json: async () => [] } as unknown as Response);
  const reading = getStudyNoteShareLinks('A');
  mockOwner = 'B';
  finish({ Authorization: 'Bearer B' });
  await expect(reading).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(apiClient).not.toHaveBeenCalled();
});
