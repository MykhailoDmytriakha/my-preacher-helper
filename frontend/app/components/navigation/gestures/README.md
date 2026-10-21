# Page gestures

summary: Familiar back navigation by a swipe across the full iPad PWA page; there is no pull to reload.

`PageGestures` is mounted once in the private layout. The swipe back is enabled
only on iPad in installed standalone PWA mode through `isIPadStandalonePwa`.
Regular browser tabs, iPhone, Android and desktop apps install no gesture listeners.

The page itself moves, as in Safari. `PageGestures` renders the private layout's
root element and shifts it with `position: relative; left` — never a transform,
which would make every fixed bar travel with it (WebKit lab `tools/webkit-lab/h.html`).
While the page is shifted, its parent clips horizontal overflow; never otherwise.
Fixed page chrome (the preaching header, text-size button, progress sidebar, meeting
screens) carries `page-gesture-follow` and reads the same offset from
`--page-gesture-x` — only while a gesture moves the page (`globals.css`).

- There is no pull to reload. It was removed on 2026-10-20 at the owner's word: it got
  in the way more than it helped. A pull at the top is left to the browser, which in an
  installed app does not reload; the reload is the header's button (`AppUpdateButton`,
  `docs/pwa.md`).
- The left 28 pixels belong to Safari: an installed app keeps the system swipe back,
  which slides the real previous page in. No gesture of ours starts there.
- From anywhere else, even after scrolling, a right swipe moves the page one to one with
  the finger over a grey underlay, with an edge shadow. Release past 90 pixels, or a quick
  flick, slides the page out (200 ms) and then goes back; a flick back to the left cancels
  even past the threshold. Speed runs from the newest report at least 50 ms before the lift,
  at that report's own time, so sparse reports can only make it slower; the final moving
  step alone can veto with a move back to the left.
- While the page leaves, touches and clicks do nothing. A back that kept the address
  glides home at once; a back that moved history waits for the route; a back that moved
  nothing for 1.5 s glides home and is not offered again on that page until history moves
  or grows. Not the Navigation API: WebKit's `canGoBack` ignores entries the router pushes.
  Known limit: whether a previous entry exists is unknowable here, so the first back at the
  first entry with forward history still bounces (~2 s).
- An abandoned swipe glides home (250 ms); a finger that catches it continues from where
  the page is drawn.
- Buttons, links and SVG icons are valid starting points. Ordinary taps still
  activate them; a recognized swipe suppresses its trailing compatibility click.
- Text editing, dialogs, selected text, sliders, drag handles, zoom and nested
  scrollers keep their own gestures. A pane that scrolls only up and down owns that
  axis alone: a swipe across it still goes back.
- Page departure, return from the back-forward cache and route changes show the page at rest.
- Motion respects reduced-motion preferences (`motion-safe:` transitions only). Words are
  announced to screen readers; on screen there is only motion, like Safari.

The bounded, content-free diagnostics record recognized gestures, exclusions and
cancellations. Reports include touch capability and viewport scale. No document text,
identifiers or touch coordinates are recorded.

Verification covers control taps versus swipes, back navigation from the center and
after scrolling, cancellation, a pull at the top that must stay the browser's, and
device exclusions. Physical iPad PWA behavior remains a separate device acceptance check.
