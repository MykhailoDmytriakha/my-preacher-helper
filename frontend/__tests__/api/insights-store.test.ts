/** @jest-environment node */
import { storeInsights } from '@/api/insights/storeInsights';
import { writeOwnedDocument } from '@/data-engine/serverEdit.server';

import type { DocumentData } from '@/data-engine/types';

jest.mock('@/data-engine/serverEdit.server', () => ({ writeOwnedDocument: jest.fn() }));
jest.mock('@repositories/sermons.repository', () => ({ sermonsRepository: { updateSermonData: jest.fn() } }));

describe('storing generated insights', () => {
  it('keeps a section that landed while this generation ran, on an engine document', async () => {
    // The sermon as it is when the verses result lands: topics were generated meanwhile.
    const current: DocumentData = { userId: 'u', insights: { topics: ['Grace'], relatedVerses: [], possibleDirections: [] } };
    jest.mocked(writeOwnedDocument).mockImplementation(async ({ engine }) => engine(current));
    const verses = [{ reference: 'John 1:14', relevance: 'Incarnation' }];

    const stored = await storeInsights('u', 's1', { topics: [], relatedVerses: [], possibleDirections: [] },
      insights => ({ ...insights, relatedVerses: verses }));

    expect(stored).toEqual({ topics: ['Grace'], relatedVerses: verses, possibleDirections: [] });
    // The sermon rises in "recent" as the legacy updateSermonData made it rise.
    const written = await jest.mocked(writeOwnedDocument).mock.calls[0][0].engine(current);
    expect(typeof written.updatedAt).toBe('string');
  });

  it('returns the legacy value when the legacy road took the write', async () => {
    jest.mocked(writeOwnedDocument).mockImplementation(async ({ legacy }) => { await legacy(); return null; });
    const stored = await storeInsights('u', 's1', undefined, insights => ({ ...insights, topics: ['Hope'] }));
    expect(stored).toEqual({ topics: ['Hope'], relatedVerses: [], possibleDirections: [] });
  });
});
