import { NextResponse } from 'next/server';

import { toUsageCapErrorPayload } from '@/services/usageLimits';

import type { UsageCapReachedError } from '@/services/usageLimits';

export const usageCapResponse = (error: UsageCapReachedError): NextResponse =>
  NextResponse.json(toUsageCapErrorPayload(error), { status: 429 });
