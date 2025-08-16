import { NextRequest, NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon } from '@/models/models';
import { generateBrainstormSuggestion } from '@clients/openAI.client';

// POST /api/sermons/:id/brainstorm
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  console.log("Brainstorm route: Received POST request for generating brainstorm suggestion");
  
  try {
    const sermonId = params.id;
    
    if (!sermonId) {
      console.error("Brainstorm route: sermonId is missing");
      return NextResponse.json({ error: "Sermon ID is required" }, { status: 400 });
    }

    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Brainstorm route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    // Generate brainstorm suggestion using AI
    const suggestion = await generateBrainstormSuggestion(sermon);
    if (!suggestion) {
      console.error("Brainstorm route: Failed to generate brainstorm suggestion");
      return NextResponse.json({ error: "Failed to generate brainstorm suggestion" }, { status: 500 });
    }

    console.log("Brainstorm route: Successfully generated brainstorm suggestion");
    
    return NextResponse.json({ suggestion });
  } catch (error: unknown) {
    console.error("Brainstorm route: Error generating brainstorm suggestion:", error);
    return NextResponse.json(
      { error: `Failed to generate brainstorm suggestion: ${error.message}` }, 
      { status: 500 }
    );
  }
} 