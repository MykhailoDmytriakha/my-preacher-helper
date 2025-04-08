import { NextRequest, NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { generatePlanForSection, generatePlanPointContent } from '@clients/openAI.client';

// Define the plan types locally to avoid import issues
interface PlanSection {
  outline: string;
  outlinePoints?: Record<string, string>;
}

interface SermonPlan {
  introduction: PlanSection;
  main: PlanSection;
  conclusion: PlanSection;
}

// GET /api/sermons/:id/plan - generates full plan by default
// GET /api/sermons/:id/plan?section=introduction|main|conclusion - generates plan for specific section
// GET /api/sermons/:id/plan?outlinePointId=<id> - generates content for a specific outline point
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const section = request.nextUrl.searchParams.get('section');
  const outlinePointId = request.nextUrl.searchParams.get('outlinePointId');
  
  // If outlinePointId is provided, generate content for the specific outline point
  if (outlinePointId) {
    return generateOutlinePointContent(id, outlinePointId);
  }
  
  // If no section is specified, generate plans for all sections
  if (!section) {
    return generateFullPlan(id);
  }
  
  // Validate section parameter
  if (!['introduction', 'main', 'conclusion'].includes(section.toLowerCase())) {
    return NextResponse.json(
      { error: 'Invalid section. Must be one of: introduction, main, conclusion' },
      { status: 400 }
    );
  }
  
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

    // Store the updated plan in the database
    try {
      // Get existing plan or create a new one
      const existingPlan: any = ('plan' in sermon ? sermon.plan : null) || {
        introduction: { outline: '' },
        main: { outline: '' },
        conclusion: { outline: '' }
      };

      // Update the section that was just generated
      const updatedPlan: SermonPlan = { 
        introduction: existingPlan.introduction || { outline: '' },
        main: existingPlan.main || { outline: '' },
        conclusion: existingPlan.conclusion || { outline: '' }
      };
      
      // Type-safe way to update the plan section
      if (section.toLowerCase() === 'introduction') {
        updatedPlan.introduction = result.plan.introduction;
      } else if (section.toLowerCase() === 'main') {
        updatedPlan.main = result.plan.main;
      } else if (section.toLowerCase() === 'conclusion') {
        updatedPlan.conclusion = result.plan.conclusion;
      }

      // Save to database
      await sermonsRepository.updateSermonPlan(id, updatedPlan);
      console.log(`Saved ${section} plan to database for sermon ${id}`);
    } catch (saveError: any) {
      console.error(`Error saving plan to database: ${saveError.message}`);
      // Continue and return the plan even if saving fails
    }
    
    return NextResponse.json(result.plan);
  } catch (error: any) {
    console.error(`Error generating plan for section ${section}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate plan', details: error.message },
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
    const fullPlan = {
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
    
    // Process each section sequentially with proper error handling
    try {
      console.log("Generating introduction plan...");
      const introResult = await generatePlanForSection(sermon, 'introduction');
      fullPlan.introduction = introResult.plan.introduction;
      fullPlan.sectionStatuses.introduction = introResult.success;
      if (!introResult.success) hasFailures = true;
      console.log(introResult.success ? 
        "Successfully generated introduction plan" : 
        "Failed to generate introduction plan");
    } catch (introError: any) {
      console.error("Failed to generate introduction plan:", introError);
      fullPlan.introduction = { outline: `Error generating introduction: ${introError.message}` };
      fullPlan.sectionStatuses.introduction = false;
      hasFailures = true;
    }
    
    try {
      console.log("Generating main plan...");
      const mainResult = await generatePlanForSection(sermon, 'main');
      fullPlan.main = mainResult.plan.main;
      fullPlan.sectionStatuses.main = mainResult.success;
      if (!mainResult.success) hasFailures = true;
      console.log(mainResult.success ? 
        "Successfully generated main plan" : 
        "Failed to generate main plan");
    } catch (mainError: any) {
      console.error("Failed to generate main plan:", mainError);
      fullPlan.main = { outline: `Error generating main part: ${mainError.message}` };
      fullPlan.sectionStatuses.main = false;
      hasFailures = true;
    }
    
    try {
      console.log("Generating conclusion plan...");
      const conclusionResult = await generatePlanForSection(sermon, 'conclusion');
      fullPlan.conclusion = conclusionResult.plan.conclusion;
      fullPlan.sectionStatuses.conclusion = conclusionResult.success;
      if (!conclusionResult.success) hasFailures = true;
      console.log(conclusionResult.success ? 
        "Successfully generated conclusion plan" : 
        "Failed to generate conclusion plan");
    } catch (conclusionError: any) {
      console.error("Failed to generate conclusion plan:", conclusionError);
      fullPlan.conclusion = { outline: `Error generating conclusion: ${conclusionError.message}` };
      fullPlan.sectionStatuses.conclusion = false;
      hasFailures = true;
    }
    
    // Store the full plan in the database, excluding sectionStatuses
    const planToStore: SermonPlan = {
      introduction: fullPlan.introduction,
      main: fullPlan.main,
      conclusion: fullPlan.conclusion
    };
    
    try {
      await sermonsRepository.updateSermonPlan(sermonId, planToStore);
      console.log(`Saved full plan to database for sermon ${sermonId}`);
    } catch (saveError: any) {
      console.error(`Error saving full plan to database: ${saveError.message}`);
      // Continue and return the plan even if saving fails
    }
    
    // Return with appropriate status code based on success
    return NextResponse.json(
      fullPlan,
      { status: hasFailures ? 206 : 200 } // 206 Partial Content if some sections failed
    );
  } catch (error: any) {
    console.error(`Error generating full sermon plan:`, error);
    return NextResponse.json(
      { error: 'Failed to generate full plan', details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to generate content for a specific outline point
async function generateOutlinePointContent(sermonId: string, outlinePointId: string) {
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
        { error: 'Outline point not found in sermon structure' },
        { status: 404 }
      );
    }
    
    // Find thoughts related to this outline point
    const relatedThoughts = sermon.thoughts.filter(thought => 
      thought.outlinePointId === outlinePointId
    );
    
    if (relatedThoughts.length === 0) {
      return NextResponse.json(
        { error: 'No thoughts associated with this outline point' },
        { status: 400 }
      );
    }
    
    // Collect all key fragments from related thoughts
    const allKeyFragments = relatedThoughts.reduce((acc: string[], thought) => {
      if (thought.keyFragments && thought.keyFragments.length > 0) {
        acc.push(...thought.keyFragments);
      }
      return acc;
    }, []);
    
    // Generate content for the outline point
    const result = await generatePlanPointContent(
      sermon.title,
      sermon.verse,
      outlinePoint.text,
      relatedThoughts.map(t => t.text),
      sectionName,
      allKeyFragments // Pass the collected key fragments
    );
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to generate content for outline point' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ content: result.content });
  } catch (error: any) {
    console.error(`Error generating content for outline point ${outlinePointId}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate content', details: error.message },
      { status: 500 }
    );
  }
}

// PUT /api/sermons/:id/plan - saves sermon plan to database
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

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
    const plan: SermonPlan = {
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
  } catch (error: any) {
    console.error(`Error saving plan for sermon ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to save plan', details: error.message },
      { status: 500 }
    );
  }
} 