import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { Sermon } from '@/models/models';
import { generateSermonInsights } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

// POST /api/insights?sermonId=<id>
export async function POST(request: Request) {
  console.log("Insights route: Received POST request for generating insights");

  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");

    if (!sermonId) {
      console.error("Insights route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }

    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Insights route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    // Generate insights using OpenAI
    const insights = await generateSermonInsights(sermon);
    if (!insights) {
      console.error("Insights route: Failed to generate insights");
      return NextResponse.json({ error: "Failed to generate insights" }, { status: 500 });
    }

    // Update the sermon with insights using sermonsRepository instead of direct adminDb
    await sermonsRepository.updateSermonData(sermonId, { insights });
    console.log("Insights route: Updated sermon with generated insights");

    return NextResponse.json({ insights });
  } catch (error) {
    console.error('Insights route: Error generating insights:', error);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}

