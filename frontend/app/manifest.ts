import { APP_THEME_COLORS } from '@/utils/themeColors';

import type { MetadataRoute } from 'next';

/**
 * Install identity is independent of the existing offline and data stores.
 * Only brand names live here: a manifest is one build-time file per origin, so it
 * cannot follow the user's locale (see docs/pwa.md, Developer contract).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'My Preacher Helper',
    short_name: 'Preacher Helper',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: APP_THEME_COLORS.background,
    theme_color: APP_THEME_COLORS.theme,
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
