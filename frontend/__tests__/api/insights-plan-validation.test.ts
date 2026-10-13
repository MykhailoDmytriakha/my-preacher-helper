import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { generateSectionHints } from '@/api/clients/openAI.client';
import { POST } from '@/api/insights/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';

jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, init: { status?: number } = {}) => ({ status: init.status ?? 200, json: async () => data }) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/api/clients/openAI.client', () => ({ generateSectionHints: jest.fn() }));
// Sermons are engine-owned everywhere: production skips the legacy callback and calls
// editOwnedDocument. writeOwnedDocument calls it inside its own module, so the road is replaced at
// writeOwnedDocument: it forwards to mockEditOwnedDocument, which applies the route's real transform
// to a seeded current document (the caller's sermon).
const mockEditOwnedDocument = jest.fn();
jest.mock('@/data-engine/serverEdit.server', () => ({
  ...jest.requireActual('@/data-engine/serverEdit.server'),
  writeOwnedDocument: ({ owner, resource, engine }: { owner: string; resource: unknown; engine: unknown }) =>
    mockEditOwnedDocument(owner, resource, engine),
}));

jest.mock('@/api/repositories/sermons.repository', () => ({ sermonsRepository: { fetchSermonById: jest.fn(), updateSermonData: jest.fn() } }));

const previousHints = { introduction: 'Existing introduction', main: 'Existing main', conclusion: 'Existing conclusion' };
const request = { url: 'https://example.com/api/insights/plan?sermonId=sermon-1' } as Request;

describe('generated section hints persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('owner');
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({ userId: 'owner', insights: { topics: ['Existing topic'], sectionHints: previousHints } });
    (sermonsRepository.updateSermonData as jest.Mock).mockResolvedValue(undefined);
    mockEditOwnedDocument.mockReset();
    mockEditOwnedDocument.mockImplementation(async (_owner: string, _resource: unknown, transform: (doc: Record<string, unknown>) => Record<string, unknown>) =>
      transform({ userId: 'owner', insights: { topics: ['Existing topic'], sectionHints: previousHints } }));
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
    expect(mockEditOwnedDocument).not.toHaveBeenCalled();
  });

  it('saves useful hints and preserves unrelated insights', async () => {
    const hints = { introduction: '', main: 'A useful direction', conclusion: '' };
    (generateSectionHints as jest.Mock).mockResolvedValue(hints);
    const result = await POST(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ insights: { topics: ['Existing topic'], sectionHints: hints } });
    expect(mockEditOwnedDocument).toHaveBeenCalledWith('owner', { collection: 'sermons', id: 'sermon-1' }, expect.any(Function));
    const saved = await mockEditOwnedDocument.mock.results[0].value;
    expect(saved.insights).toEqual({ topics: ['Existing topic'], sectionHints: hints });
    expect(sermonsRepository.updateSermonData).not.toHaveBeenCalled();
  });
});
