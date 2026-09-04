/** @jest-environment node */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import manifest from '../app/manifest';
import { APP_THEME_COLORS } from '../app/utils/themeColors';

describe('PWA manifest', () => {
  it('keeps one stable identity and allows all application routes', () => {
    expect(manifest()).toMatchObject({
      id: '/',
      name: 'My Preacher Helper',
      short_name: 'Preacher Helper',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'en',
      prefer_related_applications: false,
    });
    expect(manifest().orientation).toBeUndefined();
  });

  it('uses the shared application colors for its launch surface', () => {
    expect(manifest()).toMatchObject({
      theme_color: APP_THEME_COLORS.theme,
      background_color: APP_THEME_COLORS.background,
    });
  });

  it('provides separate standard and maskable installation icons', () => {
    expect(manifest().icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ] as const)('ships a valid opaque %s asset', async (filename, size) => {
    const asset = sharp(path.join(__dirname, '../public/icons', filename));
    expect(await asset.metadata()).toMatchObject({
      format: 'png', width: size, height: size, hasAlpha: false,
    });

    const { data, info } = await asset.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixelAt = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };

    const [backgroundRed, , backgroundBlue] = pixelAt(2, 2);
    expect(backgroundRed).toBeLessThan(90);
    expect(backgroundBlue).toBeGreaterThan(200);
    expect(pixelAt(Math.round(0.35 * info.width), Math.round(0.5 * info.height))
      .every(channel => channel >= 240)).toBe(true);
    expect(pixelAt(Math.round(0.65 * info.width), Math.round(0.5 * info.height))
      .every(channel => channel >= 200)).toBe(true);
  });

  it('keeps every maskable page pixel inside the central safe circle', async () => {
    const { data, info } = await sharp(path.join(__dirname, '../public/icons/icon-maskable-512.png'))
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const center = (info.width - 1) / 2;
    const safeRadiusSquared = (info.width * 0.4) ** 2;
    let pagePixels = 0;
    let pixelsOutsideSafeCircle = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        if (Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 200) {
          pagePixels += 1;
          if ((x - center) ** 2 + (y - center) ** 2 > safeRadiusSquared) {
            pixelsOutsideSafeCircle += 1;
          }
        }
      }
    }
    expect(pagePixels).toBeGreaterThan(1000);
    expect(pixelsOutsideSafeCircle).toBe(0);
  });

  it('ships a PNG-compressed favicon with 16, 32, and 48 pixel entries', async () => {
    const favicon = await readFile(path.join(__dirname, '../app/favicon.ico'));
    expect([...favicon.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);

    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    [16, 32, 48].forEach((width, index) => {
      const entryOffset = 6 + index * 16;
      const imageOffset = favicon.readUInt32LE(entryOffset + 12);
      expect(favicon[entryOffset]).toBe(width);
      expect([...favicon.subarray(imageOffset, imageOffset + 8)]).toEqual(pngSignature);
    });
  });

  it('keeps the vector source branded as the blue open-book icon', async () => {
    const svg = await readFile(path.join(__dirname, '../public/icons/app-icon.svg'), 'utf8');
    expect(svg).toContain('#3b82f6');
    expect(svg).toContain('#1d4ed8');
    expect(svg).toContain('#ffffff');
  });
});
