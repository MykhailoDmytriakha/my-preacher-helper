import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Insights } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import { generateSermonDirections } from '@clients/openAI.client';

// POST /api/insights/directions?sermonId=<id>
export async function POST(request: Request) {
  console.log("Directions route: Received POST request for generating possible directions");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Directions route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Directions route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Get current insights to preserve other sections
    const currentInsights = sermon.insights || { topics: [], relatedVerses: [], possibleDirections: [] };
    
    // Generate possible directions using OpenAI
    const possibleDirections = await generateSermonDirections(sermon);
    if (!possibleDirections || possibleDirections.length === 0) {
      console.error("Directions route: Failed to generate possible directions");
      return NextResponse.json({ error: "Failed to generate possible directions" }, { status: 500 });
    }
    
    // Update the sermon with new directions but preserve other insights
    const updatedInsights: Insights = {
      ...currentInsights,
      possibleDirections
    };
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights: updatedInsights });
    console.log("Directions route: Updated sermon with generated possible directions");
    
    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    console.error('Directions route: Error generating possible directions:', error);
    return NextResponse.json({ error: 'Failed to generate possible directions' }, { status: 500 });
  }
}

