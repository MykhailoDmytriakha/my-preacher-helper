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
 * Updates user settings
 */
export async function PUT(request: NextRequest) {
  try {
    const { userId, language } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    await userSettingsRepository.createOrUpdate(userId, language);
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
    const { userId, language = 'en' } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    await userSettingsRepository.createOrUpdate(userId, language);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error creating user settings:', error);
    return NextResponse.json({ error: 'Failed to create user settings' }, { status: 500 });
  }
} 