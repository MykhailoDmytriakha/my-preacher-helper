#!/usr/bin/env node

// Deterministic size exports of the existing emblem; this is not a new logo.
// Run from any directory: node frontend/scripts/generate-pwa-icons.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const source = path.join(scriptDirectory, '../app/apple-touch-icon.png');
const destination = path.join(scriptDirectory, '../public/icons');
const exportsToGenerate = [
  { name: 'icon-192.png', size: 192, inset: 0.12 },
  { name: 'icon-512.png', size: 512, inset: 0.12 },
  // A square inside the central 80%-diameter safe circle must be <=56.56% wide.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.23 },
  { name: 'apple-touch-icon.png', size: 180, inset: 0.12 },
];

async function main() {
  await fs.mkdir(destination, { recursive: true });
  for (const { name, size, inset } of exportsToGenerate) {
    const emblemSize = Math.floor(size * (1 - 2 * inset));
    const emblem = await sharp(source)
      .resize(emblemSize, emblemSize, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
      .composite([{ input: emblem, gravity: 'centre' }])
      .removeAlpha()
      .png()
      .toFile(path.join(destination, name));
    console.log(`${name}: ${size}x${size}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
