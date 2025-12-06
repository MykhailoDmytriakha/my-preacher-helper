import { NextRequest, NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { generateSermonPoints } from '@clients/openAI.client';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { section } = await request.json();
    const { id: sermonId } = await params;
    
    if (!sermonId) {
      return NextResponse.json({ error: "Sermon ID is required" }, { status: 400 });
    }
    
    if (!section || !['introduction', 'main', 'conclusion'].includes(section)) {
      return NextResponse.json({ error: "Valid section (introduction, main, conclusion) is required" }, { status: 400 });
    }

    // Get sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    // Generate outline points
    const { outlinePoints, success } = await generateSermonPoints(sermon, section);
    
    if (!success) {
      return NextResponse.json(
        { error: "Failed to generate outline points", outlinePoints: [] }, 
        { status: 500 }
      );
    }

    return NextResponse.json({ outlinePoints });
  } catch (error: unknown) {
    console.error("Error generating outline points:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to generate outline points: ${errorMessage}` }, 
      { status: 500 }
    );
  }
} 