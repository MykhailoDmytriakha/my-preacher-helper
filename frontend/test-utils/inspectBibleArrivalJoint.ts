/** Compare actual screenshot pixels in two verse gutters and where their highlight layers meet. */
export function inspectBibleArrivalJoint(
  pixels: Uint8Array, width: number, height: number, channels: number,
  rows: readonly { left: number; top: number; bottom: number }[],
) {
  if (rows.length !== 2 || channels < 3) throw new Error('Two real verse rectangles and RGB pixels are required');
  const x = Math.round(rows[0].left + 1);
  const joint = Math.round((rows[0].bottom + rows[1].top) / 2);
  const pixel = (y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) throw new Error('Verse sample is outside the screenshot');
    const offset = (y * width + x) * channels;
    return Array.from(pixels.slice(offset, offset + 3));
  };
  const bodies = rows.map(row => pixel(Math.round((row.top + row.bottom) / 2)));
  const band = Array.from({ length: 9 }, (_, i) => ({ y: joint - 4 + i, rgb: pixel(joint - 4 + i) }));
  const difference = (rgb: number[]) => Math.max(...rgb.map((value, i) => Math.abs(value - bodies[0][i])));
  const bodyDifference = difference(bodies[1]);
  const jointDifference = Math.max(...band.map(sample => difference(sample.rgb)));
  return { x, joint, bodies, band, bodyDifference, jointDifference, pass: bodyDifference <= 2 && jointDifference <= 2 };
}
