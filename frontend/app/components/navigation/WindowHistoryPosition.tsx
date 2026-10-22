'use client';

import { useEffect } from 'react';

import { installWindowHistoryPosition } from '@/utils/windowHistoryPosition.client';

/** One window-history owner across route, shell and document lifetimes. */
export function WindowHistoryPosition() {
  useEffect(installWindowHistoryPosition, []);
  return null;
}
