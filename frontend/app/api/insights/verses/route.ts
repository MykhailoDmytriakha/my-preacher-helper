import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse } from '@/data-engine/serverEdit.server';
import { Sermon } from '@/models/models';
import { generateSermonVerses } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

import { storeInsights } from '../storeInsights';

// POST /api/insights/verses?sermonId=<id>
export async function POST(request: Request) {
  console.log("Verses route: Received POST request for generating related verses");

  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");

    if (!sermonId) {
      console.error("Verses route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }

    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Verses route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');

    // Generate related verses using OpenAI
    const relatedVerses = await generateSermonVerses(sermon, uid);
    if (!relatedVerses || relatedVerses.length === 0) {
      console.error("Verses route: Failed to generate related verses");
      return NextResponse.json({ error: "Failed to generate related verses" }, { status: 500 });
    }

    // Other sections are taken from the sermon as it is when the result lands, not as it was read.
    const updatedInsights = await storeInsights(uid, sermonId, sermon.insights, current => ({ ...current, relatedVerses }));
    console.log("Verses route: Updated sermon with generated related verses");

    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    console.error('Verses route: Error generating related verses:', error);
    return NextResponse.json({ error: 'Failed to generate related verses' }, { status: 500 });
  }
}
