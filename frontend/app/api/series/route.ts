import { NextResponse } from 'next/server';

import { seriesRepository } from '@repositories/series.repository';

// GET /api/series?userId=<uid>
export async function GET(request: Request) {
  console.log("GET: Request received for retrieving series");

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
    }

    console.log(`GET: Fetching series for userId: ${userId} from Firestore...`);

    const series = await seriesRepository.fetchSeriesByUserId(userId);

    console.log(`GET: Total series retrieved: ${series.length}`);
    return NextResponse.json(series);
  } catch (error) {
    console.error('GET: Error fetching series:', error);
    return NextResponse.json({ error: 'Failed to fetch series' }, { status: 500 });
  }
}

// POST /api/series
export async function POST(request: Request) {
  console.log("POST request received for creating a series");

  try {
    const seriesData = await request.json();
    console.log("Parsed series data:", seriesData);

    const userId = seriesData.userId;
    const title = seriesData.title;
    const theme = seriesData.theme;
    const bookOrTopic = seriesData.bookOrTopic;

    if (!userId || !title || !theme || !bookOrTopic) {
      return NextResponse.json({
        error: "Missing required fields: userId, title, theme, bookOrTopic"
      }, { status: 400 });
    }

    // Validate status if provided
    const validStatuses = ['draft', 'active', 'completed'];
    if (seriesData.status && !validStatuses.includes(seriesData.status)) {
      return NextResponse.json({
        error: "Invalid status. Must be one of: draft, active, completed"
      }, { status: 400 });
    }

    // Create series using repository
    const newSeries = await seriesRepository.createSeries({
      userId,
      title,
      theme,
      bookOrTopic,
      description: seriesData.description,
      startDate: seriesData.startDate,
      duration: seriesData.duration,
      color: seriesData.color,
      status: seriesData.status || 'draft',
      sermonIds: seriesData.sermonIds || []
    });

    console.log("Returning success response for created series");
    return NextResponse.json({
      message: 'Series created successfully',
      series: newSeries
    });
  } catch (error) {
    console.error("Error occurred while creating series:", error);
    return NextResponse.json({ error: 'Failed to create series' }, { status: 500 });
  }
}
