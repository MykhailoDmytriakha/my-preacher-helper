import { chapterWeight, nextSpan, pixelsPerWeight, SIDE_CHAPTERS, spanAround, WHOLE_BOOK_VERSES } from '@/components/bible/chapterWindow';

const book = (lengths: number[]) => lengths.map((length) => Array.from({ length }, () => 'In the beginning God created the heaven and the earth.'));

describe('the chapters drawn of a big book', () => {
  it('draws a short book whole, wherever it is read', () => {
    const ruth = book([22, 23, 18, 22]);
    expect(spanAround(ruth, 3)).toEqual({ first: 1, last: 4 });
    const romans = book(Array.from({ length: 16 }, () => Math.floor(WHOLE_BOOK_VERSES / 16)));
    expect(spanAround(romans, 9)).toEqual({ first: 1, last: 16 });
  });

  it('draws whole chapters around the one read, about sixty verses on each side', () => {
    const genesis = book(Array.from({ length: 50 }, () => 30));
    // Two chapters of thirty make sixty verses on each side.
    expect(spanAround(genesis, 25)).toEqual({ first: 23, last: 27 });
  });

  it('takes no more than a few chapters on a side, however short they are', () => {
    const psalms = book(Array.from({ length: 150 }, () => 3));
    const span = spanAround(psalms, 75);
    expect(span).toEqual({ first: 75 - SIDE_CHAPTERS, last: 75 + SIDE_CHAPTERS });
  });

  it('stops at the book\'s edges', () => {
    const genesis = book(Array.from({ length: 50 }, () => 30));
    expect(spanAround(genesis, 1)).toEqual({ first: 1, last: 3 });
    expect(spanAround(genesis, 50)).toEqual({ first: 48, last: 50 });
    expect(spanAround(genesis, 999)).toEqual({ first: 48, last: 50 });
  });

  it('weighs a chapter by its letters and its verses', () => {
    expect(chapterWeight(['abc', 'de'])).toBeGreaterThan(chapterWeight(['abc']));
    expect(chapterWeight(['a'.repeat(200)])).toBeGreaterThan(chapterWeight(['a'.repeat(100)]));
  });

  it('guesses a box from the chapters measured, and not before', () => {
    expect(pixelsPerWeight([])).toBeNull();
    expect(pixelsPerWeight([{ height: 300, weight: 600 }, { height: 100, weight: 200 }])).toBe(0.5);
  });
});

describe('the chapters drawn while the person scrolls', () => {
  const genesis = book(Array.from({ length: 50 }, () => 30));
  const never = () => false;

  it('follows the place down at once: chapters below and chapters taken away move nothing read', () => {
    expect(nextSpan(genesis, { first: 23, last: 27 }, 26, true, never)).toEqual({ first: 24, last: 28 });
  });

  it('keeps chapters of a guessed height out above the place until the scroll rests', () => {
    // Moving up: chapter 22 was never drawn, so its box is a guess — it waits.
    expect(nextSpan(genesis, { first: 23, last: 27 }, 24, true, never)).toEqual({ first: 23, last: 26 });
    // Resting, it comes in, and the reader keeps the text still.
    expect(nextSpan(genesis, { first: 23, last: 27 }, 24, false, never)).toEqual({ first: 22, last: 26 });
  });

  it('draws a chapter above at once when its height is known: it was drawn before', () => {
    expect(nextSpan(genesis, { first: 23, last: 27 }, 24, true, (chapter) => chapter === 22)).toEqual({ first: 22, last: 26 });
  });

  it('keeps a guessed box at the reading line a box while text drawn below it shows: that text must not move', () => {
    // Scrolling up, the line entered chapter 22's box; chapter 23's verses still show below it.
    expect(nextSpan(genesis, { first: 23, last: 27 }, 22, true, never, 23)).toEqual({ first: 23, last: 24 });
    // Resting, 22 is drawn, and the scroll is kept on chapter 23's verse.
    expect(nextSpan(genesis, { first: 23, last: 27 }, 22, false, never, 23)).toEqual({ first: 20, last: 24 });
  });

  it('draws the chapter a fast scroll reached at once, and the guessed ones above it later', () => {
    // A fling down far past the chapters drawn: 40 is drawn at once; 38 and 39 above it are guesses.
    expect(nextSpan(genesis, { first: 23, last: 27 }, 40, true, never)).toEqual({ first: 40, last: 42 });
    expect(nextSpan(genesis, { first: 23, last: 27 }, 40, false, never)).toEqual({ first: 38, last: 42 });
  });
});
