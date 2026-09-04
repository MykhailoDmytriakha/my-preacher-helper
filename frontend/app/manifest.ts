import { APP_THEME_COLORS } from '@/utils/themeColors';

import type { MetadataRoute } from 'next';

/** Install identity is independent of the existing offline and data stores. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'My Preacher Helper',
    short_name: 'Preacher Helper',
    description: 'Capture thoughts, prepare sermons, and keep your work close at hand.',
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
