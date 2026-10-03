# Page gestures

summary: Familiar document reload and back navigation across the full iPad PWA page.

`PageGestures` is mounted once in the private layout. Both gestures are enabled
only on iPad in installed standalone PWA mode through `isIPadStandalonePwa`.
Regular browser tabs, iPhone, Android and desktop apps install no gesture listeners.

The page itself moves, as in Safari. `PageGestures` renders the private layout's
root element and shifts it with `position: relative; left/top` — never a transform,
which would make every fixed bar travel with it (WebKit lab `tools/webkit-lab/h.html`).
While the page is shifted, its parent clips horizontal overflow; never otherwise.
Fixed page chrome (the preaching header, text-size button, progress sidebar, meeting
screens) carries `page-gesture-follow` and reads the same offset from
`--page-gesture-x/y` — only while a gesture moves the page (`globals.css`).

- At the document top, pull down anywhere across its width: left, middle or right.
  The page follows the finger with resistance, a spinner appears in the opened gap,
  it arms at 72 pixels and triggers on release. Pulling back below the threshold cancels.
- Release invokes `reloadPage`, the SAME document reload as `AppUpdateButton`, and the
  page waits lowered under the spinner. No data-reader promises delay it. If the reload
  has not departed after five seconds, a visible notice says so and permits a new attempt.
- The left 28 pixels belong to Safari: an installed app keeps the system swipe back,
  which slides the real previous page in. No gesture of ours starts there, not even a pull.
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
  scrollers keep their own gestures. A page scroll cannot turn into pull-to-reload
  halfway up: the gesture must START at the document top.
- Page departure, return from the back-forward cache and route changes show the page at rest.
- Motion respects reduced-motion preferences (`motion-safe:` transitions only). Words are
  announced to screen readers; on screen there is only motion, like Safari.

The bounded, content-free diagnostics record recognized gestures, exclusions,
cancellations and reload requests. Reports include touch capability and viewport
scale. No document text, identifiers or touch coordinates are recorded.

Verification covers full-width pulls, control taps versus swipes, back navigation
from the center and after scrolling, reload delegation, cancellation and device
exclusions. Browser checks must prove a new document boot, not merely a successful
API read. Physical iPad PWA behavior remains a separate device acceptance check.
