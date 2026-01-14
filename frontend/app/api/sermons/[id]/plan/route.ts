import { NextRequest, NextResponse } from 'next/server';

import { SermonContent } from '@/models/models';
import { generatePlanForSection, generatePlanPointContent, PlanStyle } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

// Error message constants
const ERROR_MESSAGES = {
  UNKNOWN_ERROR: 'Unknown error occurred',
  SERMON_NOT_FOUND: 'Sermon not found',
} as const;

// Use the SermonContent interface from models.ts

// GET /api/sermons/:id/plan?section=introduction|main|conclusion - generates plan for specific section
// GET /api/sermons/:id/plan?outlinePointId=<id> - generates content for a specific outline point
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const section = request.nextUrl.searchParams.get('section');
  const outlinePointId = request.nextUrl.searchParams.get('outlinePointId');
  const style = request.nextUrl.searchParams.get('style') as PlanStyle | null;

  console.log('GET /api/sermons/:id/plan - section:', section, 'outlinePointId:', outlinePointId, 'style:', style);

  // If outlinePointId is provided, generate content for the specific outline point
  if (outlinePointId) {
    return generateSermonPointContent(id, outlinePointId, style || undefined);
  }

  // Validate section parameter - must be provided and valid
  if (!section) {
    console.log('Missing section parameter');
    return NextResponse.json(
      { error: 'Section parameter is required. Must be one of: introduction, main, conclusion' },
      { status: 400 }
    );
  }

  if (!['introduction', 'main', 'conclusion'].includes(section.toLowerCase())) {
    console.log('Invalid section parameter:', section);
    return NextResponse.json(
      { error: 'Invalid section. Must be one of: introduction, main, conclusion' },
      { status: 400 }
    );
  }

  console.log('Section specified:', section, 'generating plan for specific section');

  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_NOT_FOUND }, { status: 404 });
    }

    // Generate the plan for the specified section (only pass style when provided)
    const sectionName = section.toLowerCase();
    const result = style
      ? await generatePlanForSection(sermon, sectionName, style)
      : await generatePlanForSection(sermon, sectionName);

    // If generation failed, return error status
    if (!result.success) {
      return NextResponse.json(
        {
          error: `Failed to generate ${section} plan`,
          plan: result.plan
        },
        { status: 500 }
      );
    }

    // Validate and normalize the plan structure
    const normalizedPlan = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' }
    };

    // Update only the section that was generated, ensuring all sections exist
    if (section.toLowerCase() === 'introduction') {
      normalizedPlan.introduction = result.plan.introduction || { outline: '' };
    } else if (section.toLowerCase() === 'main') {
      normalizedPlan.main = result.plan.main || { outline: '' };
    } else if (section.toLowerCase() === 'conclusion') {
      normalizedPlan.conclusion = result.plan.conclusion || { outline: '' };
    }

    // Store the updated plan in the database
    try {
      // Get existing plan or create a new one
      const existingPlan = ('plan' in sermon ? sermon.plan : null) || {
        introduction: { outline: '' },
        main: { outline: '' },
        conclusion: { outline: '' }
      };

      // Update the section that was just generated
      const updatedPlan: SermonContent = {
        introduction: (existingPlan as SermonContent)?.introduction || { outline: '' },
        main: (existingPlan as SermonContent)?.main || { outline: '' },
        conclusion: (existingPlan as SermonContent)?.conclusion || { outline: '' }
      };

      // Type-safe way to update the plan section
      if (section.toLowerCase() === 'introduction') {
        updatedPlan.introduction = normalizedPlan.introduction;
      } else if (section.toLowerCase() === 'main') {
        updatedPlan.main = normalizedPlan.main;
      } else if (section.toLowerCase() === 'conclusion') {
        updatedPlan.conclusion = normalizedPlan.conclusion;
      }

      // Save to database
      await sermonsRepository.updateSermonContent(id, updatedPlan);
      console.log(`Saved ${section} plan to database for sermon ${id}`);
    } catch (saveError: unknown) {
      const errorMessage = saveError instanceof Error ? saveError.message : ERROR_MESSAGES.UNKNOWN_ERROR;
      console.error(`Error saving plan to database: ${errorMessage}`);
      // Continue and return the plan even if saving fails
    }

    return NextResponse.json(normalizedPlan);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : ERROR_MESSAGES.UNKNOWN_ERROR;
    console.error(`Error generating plan for section ${section}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate plan', details: errorMessage },
      { status: 500 }
    );
  }
}

// Helper function to generate content for a specific outline point
async function generateSermonPointContent(sermonId: string, outlinePointId: string, style?: PlanStyle) {
  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_NOT_FOUND }, { status: 404 });
    }

    // Find the outline point in the sermon structure
    let outlinePoint;
    let sectionName;

    if (sermon.outline?.introduction.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.introduction.find(op => op.id === outlinePointId);
      sectionName = 'introduction';
    } else if (sermon.outline?.main.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.main.find(op => op.id === outlinePointId);
      sectionName = 'main';
    } else if (sermon.outline?.conclusion.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.conclusion.find(op => op.id === outlinePointId);
      sectionName = 'conclusion';
    }

    if (!outlinePoint || !sectionName) {
      return NextResponse.json(
        { error: 'SermonOutline point not found in sermon structure' },
        { status: 404 }
      );
    }

    // Find thoughts related to this outline point AND sort them based on structure
    const structureIds = sermon.structure?.[sectionName as keyof typeof sermon.structure];
    const structureIdsArray: string[] = Array.isArray(structureIds) ? structureIds :
      (typeof structureIds === 'string' ? JSON.parse(structureIds) : []);

    const thoughtsForPoint = sermon.thoughts.filter(thought =>
      thought.outlinePointId === outlinePointId
    );

    const relatedThoughts = structureIdsArray.length > 0 ?
      thoughtsForPoint.sort((a, b) => {
        const indexA = structureIdsArray.indexOf(a.id);
        const indexB = structureIdsArray.indexOf(b.id);
        if (indexA === -1) return 1; // Put thoughts not in structure at the end
        if (indexB === -1) return -1;
        return indexA - indexB;
      }) :
      thoughtsForPoint; // Use unsorted if structure is empty

    if (relatedThoughts.length === 0) {
      return NextResponse.json(
        { error: 'No thoughts associated with this outline point' },
        { status: 400 }
      );
    }

    // Extract texts and key fragments from the (now sorted) thoughts
    const relatedThoughtsTexts = relatedThoughts.map(thought => thought.text);
    const keyFragments = relatedThoughts.reduce((acc: string[], thought) => {
      if (thought.keyFragments && thought.keyFragments.length > 0) {
        return acc.concat(thought.keyFragments);
      }
      return acc;
    }, []);

    // Fetch adjacent outline points for context
    const adjacentContext = await sermonsRepository.fetchAdjacentOutlinePoints(sermonId, outlinePointId);

    // Generate the content using the AI client
    const { content, success } = await generatePlanPointContent(
      sermon.title,
      sermon.verse,
      outlinePoint.text,
      relatedThoughtsTexts, // Pass sorted texts
      sectionName,
      keyFragments, // Pass combined key fragments
      adjacentContext || undefined, // Pass context if available
      style || 'memory' // Pass style
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to generate content for outline point' },
        { status: 500 }
      );
    }

    return NextResponse.json({ content });
  } catch (error: unknown) {
    console.error(`Error generating content for outline point ${outlinePointId}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate content', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// PUT /api/sermons/:id/plan - saves sermon plan to database
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get the sermon to confirm it exists
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_NOT_FOUND }, { status: 404 });
    }

    // Parse the request body to get the plan
    const planData = await request.json();
    console.log("get new planData to save", planData);

    // Validate the plan structure
    if (!planData || typeof planData !== 'object') {
      return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 });
    }

    // Ensure the content has all required sections
    const content: SermonContent = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' }
    };

    // Update with provided data, maintaining nested structure
    if (planData.introduction) {
      content.introduction = {
        outline: planData.introduction.outline || '',
        ...(planData.introduction.outlinePoints && { outlinePoints: planData.introduction.outlinePoints })
      };
      console.log("saved introduction content", content.introduction);
    }

    if (planData.main) {
      content.main = {
        outline: planData.main.outline || '',
        ...(planData.main.outlinePoints && { outlinePoints: planData.main.outlinePoints })
      };
      console.log("saved main content", content.main);
    }

    if (planData.conclusion) {
      content.conclusion = {
        outline: planData.conclusion.outline || '',
        ...(planData.conclusion.outlinePoints && { outlinePoints: planData.conclusion.outlinePoints })
      };
      console.log("saved conclusion content", content.conclusion);
    }

    // Save content to database
    await sermonsRepository.updateSermonContent(id, content);

    return NextResponse.json({ success: true, plan: content });
  } catch (error: unknown) {
    console.error(`Error saving plan for sermon ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to save plan', details: (error as Error).message },
      { status: 500 }
    );
  }
}