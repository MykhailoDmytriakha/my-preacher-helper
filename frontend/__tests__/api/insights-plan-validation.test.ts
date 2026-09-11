import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { generateSectionHints } from '@/api/clients/openAI.client';
import { POST } from '@/api/insights/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';

jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, init: { status?: number } = {}) => ({ status: init.status ?? 200, json: async () => data }) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/api/clients/openAI.client', () => ({ generateSectionHints: jest.fn() }));
jest.mock('@/api/repositories/sermons.repository', () => ({ sermonsRepository: { fetchSermonById: jest.fn(), updateSermonData: jest.fn() } }));

const previousHints = { introduction: 'Existing introduction', main: 'Existing main', conclusion: 'Existing conclusion' };
const request = { url: 'https://example.com/api/insights/plan?sermonId=sermon-1' } as Request;

describe('generated section hints persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('owner');
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({ userId: 'owner', insights: { topics: ['Existing topic'], sectionHints: previousHints } });
    (sermonsRepository.updateSermonData as jest.Mock).mockResolvedValue(undefined);
  });

  it.each([
    { introduction: '', main: '', conclusion: '' },
    { introduction: '  ', main: '\n\t', conclusion: ' ' },
    null,
  ])('rejects empty hints without overwriting the existing plan: %j', async (hints) => {
    (generateSectionHints as jest.Mock).mockResolvedValue(hints);
    const result = await POST(request);
    expect(result.status).toBe(500);
    expect(sermonsRepository.updateSermonData).not.toHaveBeenCalled();
  });

  it('saves useful hints and preserves unrelated insights', async () => {
    const hints = { introduction: '', main: 'A useful direction', conclusion: '' };
    (generateSectionHints as jest.Mock).mockResolvedValue(hints);
    const result = await POST(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ insights: { topics: ['Existing topic'], sectionHints: hints } });
    expect(sermonsRepository.updateSermonData).toHaveBeenCalledWith('sermon-1', { insights: { topics: ['Existing topic'], sectionHints: hints } }, 'insights');
  });
});
