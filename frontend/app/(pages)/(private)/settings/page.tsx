'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import {
  DEFAULT_SETTINGS_SECTION,
  sectionFromLegacyName,
  settingsSectionHref,
} from '@/utils/settingsSections';

/**
 * THE BARE ADDRESS STILL HAS TO LEAD SOMEWHERE.
 *
 * `/settings` is linked from the navigation, the breadcrumb and the admin screen, and every
 * bookmark written before the split carries `?section=`. Both are answered here, by sending
 * the person to the section's own address instead of keeping a second way to reach it.
 */
export default function SettingsIndexPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = sectionFromLegacyName(searchParams?.get('section'));

  useEffect(() => {
    router.replace(settingsSectionHref(requested ?? DEFAULT_SETTINGS_SECTION));
  }, [requested, router]);

  return null;
}
