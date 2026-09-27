import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { readSharedNotePreview } from '@/services/sharedNotePreview.server';
import { cardSafeText } from '@/utils/sharedNotePreview';

export const alt = 'My Preacher Helper';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SITE_NAME = 'My Preacher Helper';
const SITE_HOST = 'my-preacher-helper.com';

// Paper and ink rather than the app's chrome: the card sits in a chat among photos and has to
// read as a page of someone's study. The accent is the studies colour from the dashboard.
const PAPER = '#FBF8F1';
const INK = '#1F2937';
const MUTED = '#6B7280';
const ACCENT = '#047857';
const ACCENT_SOFT = '#D1FAE5';

// The fonts ship with the app: the font `next/og` carries has no Cyrillic, and a card that
// depends on a font service answering at the moment a messenger asks is a card that sometimes
// comes out blank. `next.config.mjs` names the folder for the serverless bundle.
const FONT_DIR = join(process.cwd(), 'assets/fonts');

interface Card {
  kind?: string;
  title: string;
  passages?: string;
}

async function loadFonts() {
  const [serifBold, sans, sansBold] = await Promise.all([
    readFile(join(FONT_DIR, 'PT_Serif-Web-Bold.ttf')),
    readFile(join(FONT_DIR, 'PT_Sans-Web-Regular.ttf')),
    readFile(join(FONT_DIR, 'PT_Sans-Web-Bold.ttf')),
  ]);
  return [
    { name: 'PT Serif', data: serifBold, weight: 700 as const, style: 'normal' as const },
    { name: 'PT Sans', data: sans, weight: 400 as const, style: 'normal' as const },
    { name: 'PT Sans', data: sansBold, weight: 700 as const, style: 'normal' as const },
  ];
}

/** A long title steps down in size instead of running off the card. */
function titleSize(title: string): number {
  if (title.length <= 32) return 76;
  if (title.length <= 60) return 64;
  return 52;
}

function renderCard(card: Card, fonts: Awaited<ReturnType<typeof loadFonts>>, emoji?: 'twemoji'): Promise<ArrayBuffer> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px 56px 96px',
          background: PAPER,
          borderLeft: `20px solid ${ACCENT}`,
          fontFamily: 'PT Sans',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {card.kind && (
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  display: 'flex',
                  padding: '8px 22px',
                  borderRadius: 999,
                  background: ACCENT_SOFT,
                  color: ACCENT,
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                }}
              >
                {card.kind}
              </div>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              fontFamily: 'PT Serif',
              fontWeight: 700,
              fontSize: titleSize(card.title),
              lineHeight: 1.15,
              color: INK,
            }}
          >
            {card.title}
          </div>
          {card.passages && (
            <div style={{ display: 'flex', fontSize: 32, color: ACCENT, fontWeight: 700 }}>{card.passages}</div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: MUTED }}>
          <div style={{ display: 'flex', fontWeight: 700, color: INK }}>{SITE_NAME}</div>
          <div style={{ display: 'flex' }}>{SITE_HOST}</div>
        </div>
      </div>
    ),
    { ...size, fonts, ...(emoji ? { emoji } : {}) }
  ).arrayBuffer();
}

export default async function Image({ params }: { params: { token: string } }) {
  const { token } = await params;
  const [preview, fonts] = await Promise.all([readSharedNotePreview(token), loadFonts()]);
  const card: Card = { kind: preview?.kind, title: preview?.title ?? SITE_NAME, passages: preview?.passages };

  let png: ArrayBuffer;
  try {
    png = await renderCard(card, fonts, 'twemoji');
  } catch (error) {
    // Emoji and scripts beyond Latin and Cyrillic are fetched from the network while drawing;
    // when that fails the card is drawn without them rather than not at all.
    console.error('opengraph-image: full render failed, drawing a plain card', error);
    png = await renderCard(
      {
        kind: card.kind ? cardSafeText(card.kind) || undefined : undefined,
        title: cardSafeText(card.title) || SITE_NAME,
        passages: card.passages ? cardSafeText(card.passages) || undefined : undefined,
      },
      fonts
    );
  }

  // `ImageResponse` would cache this for a year; a revoked or deleted note must not keep its
  // card at the edge that long. Messengers keep their own copy of a card they already fetched.
  return new Response(png, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } });
}
