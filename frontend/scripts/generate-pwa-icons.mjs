#!/usr/bin/env node

// Deterministic PWA exports from the vector source of truth.
// Run from frontend: node scripts/generate-pwa-icons.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const source = path.join(scriptDirectory, '../public/icons/app-icon.svg');
const destination = path.join(scriptDirectory, '../public/icons');
const exportsToGenerate = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

async function renderPng(svg, size) {
  return sharp(svg, { density: 300 })
    .resize(size, size)
    .removeAlpha()
    .png()
    .toBuffer();
}

function createIco(pngs) {
  const directorySize = 6 + pngs.length * 16;
  const totalSize = directorySize + pngs.reduce((total, { png }) => total + png.length, 0);
  const ico = Buffer.alloc(totalSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(pngs.length, 4);

  let imageOffset = directorySize;
  for (const [index, { size, png }] of pngs.entries()) {
    const entryOffset = 6 + index * 16;
    // ICONDIRENTRY: dimensions, color/reserved bytes, planes, bit count, PNG length, offset.
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset);
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(png.length, entryOffset + 8);
    ico.writeUInt32LE(imageOffset, entryOffset + 12);
    png.copy(ico, imageOffset);
    imageOffset += png.length;
  }

  return ico;
}

async function main() {
  const svg = await fs.readFile(source);
  await fs.mkdir(destination, { recursive: true });
  for (const { name, size } of exportsToGenerate) {
    await fs.writeFile(path.join(destination, name), await renderPng(svg, size));
    console.log(`${name}: ${size}x${size}`);
  }

  const faviconPngs = await Promise.all([16, 32, 48].map(async size => ({
    size,
    png: await renderPng(svg, size),
  })));
  await fs.writeFile(path.join(scriptDirectory, '../app/favicon.ico'), createIco(faviconPngs));
  console.log('app/favicon.ico: 16x16, 32x32, 48x48');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
