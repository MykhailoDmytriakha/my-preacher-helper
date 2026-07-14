import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import {
  generateBrainstormSuggestion,
  generateSectionHints,
  generateSermonDirections,
  generateSermonInsights,
  generateSermonPoints,
  generateSermonTopics,
  generateSermonVerses,
  sortItemsWithAI,
} from '@/api/clients/openAI.client';
import { POST as brainstormPost } from '@/api/sermons/[id]/brainstorm/route';
import { POST as outlinePointsPost } from '@/api/sermons/[id]/generate-outline-points/route';
import { POST as directionsPost } from '@/api/insights/directions/route';
import { POST as insightsPost } from '@/api/insights/route';
import { POST as planPost } from '@/api/insights/plan/route';
import { POST as topicsPost } from '@/api/insights/topics/route';
import { POST as versesPost } from '@/api/insights/verses/route';
import { POST as sortPost } from '@/api/sort/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init: { status?: number } = {}) => ({
      status: init.status ?? 200,
      json: async () => data,
    })),
  },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

jest.mock('@/api/repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
    updateSermonData: jest.fn(),
  },
}));

jest.mock('@/api/clients/openAI.client', () => ({
  generateBrainstormSuggestion: jest.fn(),
  generateSectionHints: jest.fn(),
  generateSermonDirections: jest.fn(),
  generateSermonInsights: jest.fn(),
  generateSermonPoints: jest.fn(),
  generateSermonTopics: jest.fn(),
  generateSermonVerses: jest.fn(),
  sortItemsWithAI: jest.fn(),
}));

type RouteCase = {
  name: string;
  invoke: () => Promise<{ status: number; json: () => Promise<unknown> }>;
  ai: jest.Mock;
  aiResult: unknown;
};

const queryRequest = (path: string) => ({
  url: `https://example.com${path}?sermonId=sermon-1`,
}) as Request;

const jsonRequest = (body: unknown) => ({
  json: jest.fn().mockResolvedValue(body),
}) as unknown as Request;

const routeCases: RouteCase[] = [
  {
    name: '/api/insights',
    invoke: () => insightsPost(queryRequest('/api/insights')),
    ai: generateSermonInsights as jest.Mock,
    aiResult: { topics: ['topic'] },
  },
  {
    name: '/api/insights/directions',
    invoke: () => directionsPost(queryRequest('/api/insights/directions')),
    ai: generateSermonDirections as jest.Mock,
    aiResult: ['direction'],
  },
  {
    name: '/api/insights/plan',
    invoke: () => planPost(queryRequest('/api/insights/plan')),
    ai: generateSectionHints as jest.Mock,
    aiResult: { introduction: ['hint'] },
  },
  {
    name: '/api/insights/topics',
    invoke: () => topicsPost(queryRequest('/api/insights/topics')),
    ai: generateSermonTopics as jest.Mock,
    aiResult: ['topic'],
  },
  {
    name: '/api/insights/verses',
    invoke: () => versesPost(queryRequest('/api/insights/verses')),
    ai: generateSermonVerses as jest.Mock,
    aiResult: ['John 3:16'],
  },
  {
    name: '/api/sermons/[id]/brainstorm',
    invoke: () => brainstormPost(jsonRequest({}) as never, { params: Promise.resolve({ id: 'sermon-1' }) }),
    ai: generateBrainstormSuggestion as jest.Mock,
    aiResult: { text: 'idea', type: 'context' },
  },
  {
    name: '/api/sermons/[id]/generate-outline-points',
    invoke: () => outlinePointsPost(jsonRequest({ section: 'introduction' }) as never, {
      params: Promise.resolve({ id: 'sermon-1' }),
    }),
    ai: generateSermonPoints as jest.Mock,
    aiResult: { outlinePoints: [{ id: 'point-1', text: 'Point' }], success: true },
  },
  {
    name: '/api/sort',
    invoke: () => sortPost(jsonRequest({
      columnId: 'introduction',
      items: [{ id: 'thought-1', content: 'Thought' }],
      sermonId: 'sermon-1',
      outlinePoints: [],
    })),
    ai: sortItemsWithAI as jest.Mock,
    aiResult: [{ id: 'thought-1', content: 'Thought' }],
  },
];

describe.each(routeCases)('$name authorization and metering identity', ({ invoke, ai, aiResult }) => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('caller-uid');
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({
      id: 'sermon-1',
      userId: 'caller-uid',
      title: 'Sermon',
      verse: 'John 3:16',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
    });
    (sermonsRepository.updateSermonData as jest.Mock).mockResolvedValue(undefined);
    ai.mockResolvedValue(aiResult);
  });

  it('returns 401 before reading the resource when the token is missing', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  it('returns 403 without AI or persistence for a non-owner', async () => {
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValueOnce({
      id: 'sermon-1',
      userId: 'victim-uid',
    });

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(ai).not.toHaveBeenCalled();
    expect(sermonsRepository.updateSermonData).not.toHaveBeenCalled();
  });

  it('uses the authenticated caller uid for the AI/metering path', async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai.mock.calls[0]).toContain('caller-uid');
  });
});
