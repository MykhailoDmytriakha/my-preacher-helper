import { echoedPosition, SCROLL_ECHO_MS } from '@/components/bible/readingSurface';

// BUG-20261107-ipad-safari-arrival-drifts-under-late-text, traced in the iPad simulator's Safari: the reader set the pane to 5531,
// Safari reported 5407 — where the reader had put it before — 10 ms later and 5531 again 22 ms after; taken for the person's
// scroll, the report let the verse go, and the comments drawn above it later pushed it 80 px down.
describe('a reported position the browser echoes back', () => {
  const hold = { scrollY: 5531, earlier: [0, 5407], input: false, at: 1000 };
  const soon = 1010;

  it('is a position the reader set before, reported in the moment after it moved the page, with no input from the person', () => {
    expect(echoedPosition(5407, hold, soon)).toBe(true);
    expect(echoedPosition(0.4, hold, soon)).toBe(true);
  });

  it('is not the position the reader set last', () => {
    expect(echoedPosition(5531, hold, soon)).toBe(false);
  });

  it('is not a position the reader never set', () => {
    expect(echoedPosition(5300, hold, soon)).toBe(false);
  });

  it('is not one after the person touched, scrolled, pressed or typed — even back to where the page stood (Home)', () => {
    expect(echoedPosition(0, { ...hold, input: true }, soon)).toBe(false);
    expect(echoedPosition(5407, { ...hold, input: true }, soon)).toBe(false);
  });

  // Codex review: a move back long after — find in page, which scrolls with no input on the page — is no echo.
  it('is not one reported after the moment has passed', () => {
    expect(echoedPosition(5407, hold, hold.at + SCROLL_ECHO_MS)).toBe(false);
  });
});
