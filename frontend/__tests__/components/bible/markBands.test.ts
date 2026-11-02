import { clearRowBands, fillsPaintedOn, paintRowBands } from '@/components/bible/marks/markBands';

/*
 * THE MARKER AS ROUNDED BANDS OF ONE HEIGHT (the owner, 2026-11-02: his iPad drew the browser's highlight taller on some
 * lines, with square corners). jsdom lays nothing out, so the row and the words' boxes are given.
 */
const box = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
const rowAt = () => {
  const row = document.createElement('div');
  row.innerHTML = '<span data-verse-text="">alpha beta gamma</span>';
  document.body.append(row);
  jest.spyOn(row, 'getBoundingClientRect').mockReturnValue({ ...box(100, 400, 200, 270), x: 100, y: 200, toJSON: () => ({}) });
  return row;
};
const rangeWith = (row: HTMLElement, boxes: ReturnType<typeof box>[]) => {
  const range = document.createRange();
  range.selectNodeContents(row.firstChild as Node);
  Object.defineProperty(range, 'getClientRects', { value: () => boxes });
  return range;
};
/** The rectangles of the row's picture. */
const rects = (row: HTMLElement) => {
  const image = row.style.getPropertyValue('background-image');
  const svg = decodeURIComponent(/svg\+xml,([^")]+)/.exec(image)?.[1] ?? '');
  return [...svg.matchAll(/<rect x='([\d.]+)' y='([\d.-]+)' width='([\d.]+)' height='(\d+)' rx='([\d.]+)' fill='([^']+)'\/>/g)]
    .map(([, x, y, width, height, rx, fill]) => ({ x: +x, y: +y, width: +width, height: +height, rx: +rx, fill }));
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.setProperty('--mark-fill-red', '#803435');
  document.documentElement.style.setProperty('--mark-fill-blue', '#374b89');
});
afterEach(() => jest.restoreAllMocks());

describe('the marker\'s bands', () => {
  it('gives every line the same height, rounded, in the theme\'s colour, against the row', () => {
    const row = rowAt();
    // Two lines whose boxes differ in height (a chip beside one of them): the bands do not.
    paintRowBands(row, [['red', rangeWith(row, [box(120, 220, 205, 228), box(100, 180, 236, 266)])]]);
    const [first, second] = rects(row);
    expect(first.height).toBe(second.height);
    expect(first.rx).toBeGreaterThan(0);
    expect(first.fill).toBe('#803435');
    // Centred on each line's words, placed against the row (the row starts at 100, 200).
    // The band's top is a whole pixel (no blurred edge): its centre stays within half a pixel of the words'.
    expect(Math.abs(first.y + first.height / 2 - (216.5 - 200))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(second.y + second.height / 2 - (251 - 200))).toBeLessThanOrEqual(0.5);
    expect(first.x).toBe(18);
    expect(row.style.getPropertyValue('background-repeat')).toBe('no-repeat');
  });

  it('joins the pieces of one line into one band, and keeps two marks apart', () => {
    const row = rowAt();
    paintRowBands(row, [
      ['red', rangeWith(row, [box(120, 150, 205, 228), box(150, 200, 205, 228)])],
      ['blue', rangeWith(row, [box(210, 260, 205, 228)])],
    ]);
    const drawn = rects(row);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toEqual(expect.objectContaining({ width: 84, fill: '#803435' }));
    expect(drawn[1]).toEqual(expect.objectContaining({ fill: '#374b89' }));
  });

  it('clears the row when nothing is left to draw', () => {
    const row = rowAt();
    paintRowBands(row, [['red', rangeWith(row, [box(120, 220, 205, 228)])]]);
    expect(fillsPaintedOn(row)).toHaveLength(1);
    paintRowBands(row, []);
    expect(row.style.getPropertyValue('background-image')).toBe('');
    expect(fillsPaintedOn(row)).toHaveLength(0);
    paintRowBands(row, [['red', rangeWith(row, [box(120, 220, 205, 228)])]]);
    clearRowBands(row);
    expect(row.style.getPropertyValue('background-image')).toBe('');
  });
});
