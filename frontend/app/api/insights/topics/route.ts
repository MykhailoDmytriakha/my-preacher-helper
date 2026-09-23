import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse } from '@/data-engine/serverEdit.server';
import { Sermon } from '@/models/models';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { generateSermonTopics } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

import { storeInsights } from '../storeInsights';

// POST /api/insights/topics?sermonId=<id>
export async function POST(request: Request) {
  console.log("Topics route: Received POST request for generating sermon topics");

  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");

    if (!sermonId) {
      console.error("Topics route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }

    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Topics route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');

    // Generate topics using OpenAI
    const topics = await generateSermonTopics(sermon, uid);
    if (!topics || topics.length === 0) {
      console.error("Topics route: Failed to generate topics");
      return NextResponse.json({ error: "Failed to generate topics" }, { status: 500 });
    }

    // Other sections are taken from the sermon as it is when the result lands, not as it was read.
    const updatedInsights = await storeInsights(uid, sermonId, sermon.insights, current => ({ ...current, topics }));
    console.log("Topics route: Updated sermon with generated topics");

    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    console.error('Topics route: Error generating topics:', error);
    return NextResponse.json({ error: 'Failed to generate topics' }, { status: 500 });
  }
}
