import { NextRequest, NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { generatePlanForSection, generatePlanPointContent } from '@clients/openAI.client';
import { SermonDraft } from '@/models/models';

// Use the SermonDraft interface from models.ts

// GET /api/sermons/:id/plan - generates full plan by default
// GET /api/sermons/:id/plan?section=introduction|main|conclusion - generates plan for specific section
// GET /api/sermons/:id/plan?outlinePointId=<id> - generates content for a specific outline point
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const section = request.nextUrl.searchParams.get('section');
  const outlinePointId = request.nextUrl.searchParams.get('outlinePointId');
  
  console.log('GET /api/sermons/:id/plan - section:', section, 'outlinePointId:', outlinePointId);
  
  // If outlinePointId is provided, generate content for the specific outline point
  if (outlinePointId) {
    return generateSermonPointContent(id, outlinePointId);
  }
  
  // Validate section parameter if provided
  if (section && !['introduction', 'main', 'conclusion'].includes(section.toLowerCase())) {
    console.log('Invalid section parameter:', section);
    return NextResponse.json(
      { error: 'Invalid section. Must be one of: introduction, main, conclusion' },
      { status: 400 }
    );
  }
  
  // If no section is specified, generate plans for all sections
  if (!section) {
    console.log('No section specified, generating full plan');
    return generateFullPlan(id);
  }
  
  console.log('Section specified:', section, 'generating plan for specific section');
  
  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
    }
    
    // Generate the plan for the specified section
    const result = await generatePlanForSection(sermon, section.toLowerCase());
    
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
      const updatedPlan: SermonDraft = { 
        introduction: (existingPlan as SermonDraft)?.introduction || { outline: '' },
        main: (existingPlan as SermonDraft)?.main || { outline: '' },
        conclusion: (existingPlan as SermonDraft)?.conclusion || { outline: '' }
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
      await sermonsRepository.updateSermonPlan(id, updatedPlan);
      console.log(`Saved ${section} plan to database for sermon ${id}`);
    } catch (saveError: unknown) {
      const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error occurred';
      console.error(`Error saving plan to database: ${errorMessage}`);
      // Continue and return the plan even if saving fails
    }
    
    return NextResponse.json(normalizedPlan);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`Error generating plan for section ${section}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate plan', details: errorMessage },
      { status: 500 }
    );
  }
}

// Helper function to generate plans for all sections
async function generateFullPlan(sermonId: string) {
  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
    }
    
    // Create a full plan object with empty sections initially
    const fullPlan: {
      introduction: { outline: string; outlinePoints?: Record<string, string> };
      main: { outline: string; outlinePoints?: Record<string, string> };
      conclusion: { outline: string; outlinePoints?: Record<string, string> };
      sectionStatuses: {
        introduction: boolean;
        main: boolean;
        conclusion: boolean;
      };
    } = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' },
      sectionStatuses: {
        introduction: false,
        main: false,
        conclusion: false
      }
    };
    
    // Track if any section failed to generate
    let hasFailures = false;
    
    // Declare result variables to check for incomplete structure
    let introResult: { plan: SermonDraft, success: boolean } | null = null;
    let mainResult: { plan: SermonDraft, success: boolean } | null = null;
    let conclusionResult: { plan: SermonDraft, success: boolean } | null = null;
    
    // Process each section sequentially with proper error handling
    try {
      console.log("Generating introduction plan...");
      introResult = await generatePlanForSection(sermon, 'introduction');
      console.log("Introduction result:", JSON.stringify(introResult, null, 2));
      
      // Validate introduction plan structure
      if (introResult.plan?.introduction?.outline !== undefined && 
          introResult.plan.introduction.outline !== null && 
          typeof introResult.plan.introduction.outline === 'string') {
        fullPlan.introduction = introResult.plan.introduction;
      } else {
        console.error("Invalid introduction plan structure:", introResult.plan);
        fullPlan.introduction = { outline: '' };
      }
      
      fullPlan.sectionStatuses.introduction = introResult.success;
      if (!introResult.success) hasFailures = true;
      console.log(introResult.success ? 
        "Successfully generated introduction plan" : 
        "Failed to generate introduction plan");
    } catch (introError: unknown) {
      const errorMessage = introError instanceof Error ? introError.message : 'Unknown error occurred';
      console.error("Failed to generate introduction plan:", introError);
      fullPlan.introduction = { outline: `Error generating introduction: ${errorMessage}` };
      fullPlan.sectionStatuses.introduction = false;
      hasFailures = true;
    }
    
    try {
      console.log("Generating main plan...");
      mainResult = await generatePlanForSection(sermon, 'main');
      console.log("Main result:", JSON.stringify(mainResult, null, 2));
      
      // Validate main plan structure
      if (mainResult.plan?.main?.outline !== undefined && 
          mainResult.plan.main.outline !== null && 
          typeof mainResult.plan.main.outline === 'string') {
        fullPlan.main = mainResult.plan.main;
      } else {
        console.error("Invalid main plan structure:", mainResult.plan);
        fullPlan.main = { outline: '' };
      }
      
      fullPlan.sectionStatuses.main = mainResult.success;
      if (!mainResult.success) hasFailures = true;
      console.log(mainResult.success ? 
        "Successfully generated main plan" : 
        "Failed to generate main plan");
    } catch (mainError: unknown) {
      const errorMessage = mainError instanceof Error ? mainError.message : 'Unknown error occurred';
      console.error("Failed to generate main plan:", mainError);
      fullPlan.main = { outline: `Error generating main part: ${errorMessage}` };
      fullPlan.sectionStatuses.main = false;
      hasFailures = true;
    }
    
    try {
      console.log("Generating conclusion plan...");
      conclusionResult = await generatePlanForSection(sermon, 'conclusion');
      console.log("Conclusion result:", JSON.stringify(conclusionResult, null, 2));
      
      // Validate conclusion plan structure
      if (conclusionResult.plan?.conclusion?.outline !== undefined && 
          conclusionResult.plan.conclusion.outline !== null && 
          typeof conclusionResult.plan.conclusion.outline === 'string') {
        fullPlan.conclusion = conclusionResult.plan.conclusion;
      } else {
        console.error("Invalid conclusion plan structure:", conclusionResult.plan);
        fullPlan.conclusion = { outline: '' };
      }
      
      fullPlan.sectionStatuses.conclusion = conclusionResult.success;
      if (!conclusionResult.success) hasFailures = true;
      console.log(conclusionResult.success ? 
        "Successfully generated conclusion plan" : 
        "Failed to generate conclusion plan");
    } catch (conclusionError: unknown) {
      const errorMessage = conclusionError instanceof Error ? conclusionError.message : 'Unknown error occurred';
      console.error("Failed to generate conclusion plan:", conclusionError);
      fullPlan.conclusion = { outline: `Error generating conclusion: ${errorMessage}` };
      fullPlan.sectionStatuses.conclusion = false;
      hasFailures = true;
    }
    
    // Store the full plan in the database, excluding sectionStatuses
    const planToStore: SermonDraft = {
      introduction: {
        outline: fullPlan.introduction?.outline || '',
        ...(fullPlan.introduction && 'outlinePoints' in fullPlan.introduction && { outlinePoints: (fullPlan.introduction as Record<string, unknown>).outlinePoints as Record<string, string> })
      },
      main: {
        outline: fullPlan.main?.outline || '',
        ...(fullPlan.main && 'outlinePoints' in fullPlan.main && { outlinePoints: (fullPlan.main as Record<string, unknown>).outlinePoints as Record<string, string> })
      },
      conclusion: {
        outline: fullPlan.conclusion?.outline || '',
        ...(fullPlan.conclusion && 'outlinePoints' in fullPlan.conclusion && { outlinePoints: (fullPlan.conclusion as Record<string, unknown>).outlinePoints as Record<string, string> })
      }
    };
    
    // Validate that all outline values are strings before saving
    if (typeof planToStore.introduction.outline !== 'string' || 
        typeof planToStore.main.outline !== 'string' || 
        typeof planToStore.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid plan structure - outline values must be strings');
      // Use empty strings as fallback
      planToStore.introduction.outline = planToStore.introduction.outline || '';
      planToStore.main.outline = planToStore.main.outline || '';
      planToStore.conclusion.outline = planToStore.conclusion.outline || '';
    }
    
    // Check if the AI response is completely malformed (missing sections entirely)
    const hasMissingSections = !introResult?.plan?.introduction || 
                               !mainResult?.plan?.main || 
                               !conclusionResult?.plan?.conclusion;
    
    if (hasMissingSections) {
      console.error('ERROR: AI response missing sections entirely, using fallback plan');
      planToStore.introduction = { outline: '' };
      planToStore.main = { outline: '' };
      planToStore.conclusion = { outline: '' };
    } else {
      // Validate each section individually and only reset invalid ones
      if (!introResult?.plan?.introduction?.outline || 
          typeof introResult.plan.introduction.outline !== 'string') {
        console.error('ERROR: Invalid introduction plan structure');
        planToStore.introduction = { outline: '' };
      }
      
      if (!mainResult?.plan?.main?.outline || 
          typeof mainResult.plan.main.outline !== 'string') {
        console.error('ERROR: Invalid main plan structure');
        planToStore.main = { outline: '' };
      }
      
      if (!conclusionResult?.plan?.conclusion?.outline || 
          typeof conclusionResult.plan.conclusion.outline !== 'string') {
        console.error('ERROR: Invalid conclusion plan structure');
        planToStore.conclusion = { outline: '' };
      }
    }
    
    console.log('Final plan to store:', JSON.stringify(planToStore, null, 2));
    
    try {
      await sermonsRepository.updateSermonPlan(sermonId, planToStore);
      console.log(`Saved full plan to database for sermon ${sermonId}`);
    } catch (saveError: unknown) {
      const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error occurred';
      console.error(`Error saving full plan to database: ${errorMessage}`);
      // Continue and return the plan even if saving fails
    }
    
    // Return with appropriate status code based on success
    // If all sections failed, return 500 with error message. If some sections failed, return 206
    const allSectionsFailed = !fullPlan.sectionStatuses.introduction && 
                              !fullPlan.sectionStatuses.main && 
                              !fullPlan.sectionStatuses.conclusion;
    
    if (allSectionsFailed) {
      return NextResponse.json(
        { error: 'Failed to generate full plan' },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      fullPlan,
      { status: hasFailures ? 206 : 200 }
    );
  } catch (error: unknown) {
    console.error(`Error generating full sermon plan:`, error);
    return NextResponse.json(
      { error: 'Failed to generate full plan', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// Helper function to generate content for a specific outline point
async function generateSermonPointContent(sermonId: string, outlinePointId: string) {
  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
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
    
    // Generate the content using the AI client
    const { content, success } = await generatePlanPointContent(
      sermon.title,
      sermon.verse,
      outlinePoint.text,
      relatedThoughtsTexts, // Pass sorted texts
      sectionName,
      keyFragments // Pass combined key fragments
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
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
    }

    // Parse the request body to get the plan
    const planData = await request.json();
    console.log("get new planData to save", planData);
    
    // Validate the plan structure
    if (!planData || typeof planData !== 'object') {
      return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 });
    }
    
    // Ensure the plan has all required sections
    const plan: SermonDraft = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' }
    };
    
    // Update with provided data, maintaining nested structure
    if (planData.introduction) {
      plan.introduction = {
        outline: planData.introduction.outline || '',
        ...(planData.introduction.outlinePoints && { outlinePoints: planData.introduction.outlinePoints })
      };
      console.log("saved introduction plan", plan.introduction);
    }
    
    if (planData.main) {
      plan.main = {
        outline: planData.main.outline || '',
        ...(planData.main.outlinePoints && { outlinePoints: planData.main.outlinePoints })
      };
      console.log("saved main plan", plan.main);
    }
    
    if (planData.conclusion) {
      plan.conclusion = {
        outline: planData.conclusion.outline || '',
        ...(planData.conclusion.outlinePoints && { outlinePoints: planData.conclusion.outlinePoints })
      };
      console.log("saved conclusion plan", plan.conclusion);
    }
    
    // Save plan to database
    await sermonsRepository.updateSermonPlan(id, plan);
    
    return NextResponse.json({ success: true, plan });
  } catch (error: unknown) {
    console.error(`Error saving plan for sermon ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to save plan', details: (error as Error).message },
      { status: 500 }
    );
  }
}