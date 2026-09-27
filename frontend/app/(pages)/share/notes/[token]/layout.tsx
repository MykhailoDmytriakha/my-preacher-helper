import { readSharedNotePreview } from '@/services/sharedNotePreview.server';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const SITE_NAME = 'My Preacher Helper';

const OG_LOCALES = { en: 'en_US', ru: 'ru_RU', uk: 'uk_UA' } as const;

/**
 * The page itself is a client component that loads the note in the browser; messengers never run
 * it. This layout gives the link its card on the server — the note's name, the start of its text,
 * and the image from `opengraph-image.tsx` next to it. A shared note is for the people it is sent
 * to, not for search engines, so the page asks not to be indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const preview = await readSharedNotePreview(token);
  const robots = { index: false, follow: false };
  // A link that opens no note (or could not be read) gets the site's name and nothing else:
  // an absent description would inherit the app's marketing line from the root layout.
  if (!preview) return { title: SITE_NAME, description: null, robots };

  // Passages first, then the start of the text; a note with neither still names its own kind,
  // because an absent description would inherit the app's marketing line from the root layout.
  const description = [preview.passages, preview.description].filter(Boolean).join(' — ') || preview.kind;
  return {
    title: `${preview.title} · ${SITE_NAME}`,
    description,
    robots,
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title: preview.title,
      description,
      locale: OG_LOCALES[preview.locale],
    },
    twitter: {
      card: 'summary_large_image',
      title: preview.title,
      description,
    },
  };
}

export default function SharedNoteLayout({ children }: { children: ReactNode }) {
  return children;
}
