import { NextRequest, NextResponse } from 'next/server';
import { userSettingsRepository } from '@/api/repositories/userSettings.repository';

/**
 * GET /api/user/settings
 * Retrieves user settings by userId from the query string
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    const settings = await userSettingsRepository.getByUserId(userId);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error fetching user settings:', error);
    return NextResponse.json({ error: 'Failed to fetch user settings' }, { status: 500 });
  }
}

/**
 * PUT /api/user/settings
 * Updates user settings - only updates fields provided in the request
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, language, email, displayName, enablePrepMode } = body;
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // Only pass fields that are explicitly provided in the request
    const updates: Record<string, unknown> = {};
    if ('language' in body) updates.language = language;
    if ('email' in body) updates.email = email;
    if ('displayName' in body) updates.displayName = displayName;
    if ('enablePrepMode' in body) updates.enablePrepMode = enablePrepMode;
    
    await userSettingsRepository.createOrUpdate(
      userId,
      updates.language as string | undefined,
      updates.email as string | undefined,
      updates.displayName as string | undefined,
      updates.enablePrepMode as boolean | undefined
    );
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating user settings:', error);
    return NextResponse.json({ error: 'Failed to update user settings' }, { status: 500 });
  }
}

/**
 * POST /api/user/settings
 * Creates default user settings
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, language, email, displayName, enablePrepMode } = body;
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // For new users, provide default language if not specified
    const langToUse = 'language' in body ? language : 'en';
    
    await userSettingsRepository.createOrUpdate(
      userId,
      langToUse,
      'email' in body ? email : undefined,
      'displayName' in body ? displayName : undefined,
      'enablePrepMode' in body ? enablePrepMode : undefined
    );
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error creating user settings:', error);
    return NextResponse.json({ error: 'Failed to create user settings' }, { status: 500 });
  }
} 