import { NextRequest, NextResponse } from 'next/server';

import { userSettingsRepository, UPDATABLE_FIELDS, type UserSettingsUpdate } from '@/api/repositories/userSettings.repository';
import { isFirstDayOfWeek } from '@/utils/weekStart';

// Error messages
const ERROR_MESSAGES = {
  USER_ID_REQUIRED: 'User ID is required',
  INVALID_FIRST_DAY_OF_WEEK: 'First day of week must be sunday or monday',
} as const;

/**
 * Build a settings-update object from a request body, copying only the
 * fields that are explicitly present (so partial updates stay partial).
 */
function pickSettingsUpdates(body: Record<string, unknown>): UserSettingsUpdate {
  // Single source of truth for the field list is UPDATABLE_FIELDS in the
  // repository, so the route and the persistence layer can never drift.
  const updates: UserSettingsUpdate = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) {
      (updates as Record<string, unknown>)[field] = body[field];
    }
  }
  return updates;
}

/**
 * GET /api/user/settings
 * Retrieves user settings by userId from the query string
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: ERROR_MESSAGES.USER_ID_REQUIRED }, { status: 400 });
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
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: ERROR_MESSAGES.USER_ID_REQUIRED }, { status: 400 });
    }

    if ('firstDayOfWeek' in body && !isFirstDayOfWeek(body.firstDayOfWeek)) {
      return NextResponse.json({ error: ERROR_MESSAGES.INVALID_FIRST_DAY_OF_WEEK }, { status: 400 });
    }

    await userSettingsRepository.createOrUpdate(userId, pickSettingsUpdates(body));

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
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: ERROR_MESSAGES.USER_ID_REQUIRED }, { status: 400 });
    }

    if ('firstDayOfWeek' in body && !isFirstDayOfWeek(body.firstDayOfWeek)) {
      return NextResponse.json({ error: ERROR_MESSAGES.INVALID_FIRST_DAY_OF_WEEK }, { status: 400 });
    }

    const updates = pickSettingsUpdates(body);
    // New users get a default language when none was supplied.
    if (!('language' in body)) {
      updates.language = 'en';
    }

    await userSettingsRepository.createOrUpdate(userId, updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error creating user settings:', error);
    return NextResponse.json({ error: 'Failed to create user settings' }, { status: 500 });
  }
}
