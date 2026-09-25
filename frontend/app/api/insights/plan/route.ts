import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse } from '@/data-engine/serverEdit.server';
import { Sermon } from '@/models/models';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { generateSectionHints } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

import { storeInsights } from '../storeInsights';

// POST /api/insights/plan?sermonId=<id>
export async function POST(request: Request) {
  console.log("Plan route: Received POST request for generating thoughts plan");

  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");

    if (!sermonId) {
      console.error("Plan route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }

    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Plan route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');

    // Generate thoughts plan using OpenAI
    const sectionHints = await generateSectionHints(sermon, uid);
    if (!sectionHints || !Object.values(sectionHints).some((hint) => typeof hint === 'string' && hint.trim().length > 0)) {
      console.error("Plan route: Failed to generate thoughts plan");
      return NextResponse.json({ error: "Failed to generate thoughts plan" }, { status: 500 });
    }

    // Other sections are taken from the sermon as it is when the result lands, not as it was read.
    const updatedInsights = await storeInsights(uid, sermonId, sermon.insights, current => ({ ...current, sectionHints }));
    console.log("Plan route: Updated sermon with generated thoughts plan");

    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    console.error('Plan route: Error generating thoughts plan:', error);
    return NextResponse.json({ error: 'Failed to generate thoughts plan' }, { status: 500 });
  }
}
