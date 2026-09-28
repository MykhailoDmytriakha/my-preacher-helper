# Page gestures

summary: Familiar document reload and back navigation across the full iPad PWA page.

`PageGestures` is mounted once in the private layout. Both gestures are enabled
only on iPad in installed standalone PWA mode through `isIPadStandalonePwa`.
Regular browser tabs, iPhone, Android and desktop apps install no gesture listeners.

- At the document top, pull down anywhere across its width: left, middle or right.
  The indicator follows the finger with resistance, arms at 72 visual pixels,
  and triggers on release. Pulling back below the threshold cancels it.
- Release invokes `reloadPage`, the SAME document reload as `AppUpdateButton`.
  No data-reader promises, query refetches or editor reconciliation delay it.
  Existing page lifecycle and durable-draft behavior are identical to the button.
- A right swipe starts anywhere across the page, even after scrolling down.
  It navigates back after 90 pixels when history exists. Short, reversed or
  diagonal gestures cancel. Back remains available while reload is starting.
- Buttons, links and SVG icons are valid starting points. Ordinary taps still
  activate them; a recognized swipe suppresses its trailing compatibility click.
- Text editing, dialogs, selected text, sliders, drag handles, zoom and nested
  scrollers keep their own gestures. A page scroll cannot turn into pull-to-reload
  halfway up: the gesture must START at the document top.
- The free left edge is claimed at touchstart to avoid duplicate WebKit navigation.
  Elsewhere, direction is established before claiming the movement.
- Page departure, return from the back-forward cache and route changes clear the
  indicator. If a requested reload has not departed after five seconds, the
  indicator reports that the page could not reload and permits a new attempt.
- Motion respects reduced-motion preferences; text is translated in all locales.

The bounded, content-free diagnostics record recognized gestures, exclusions,
cancellations and reload requests. Reports include touch capability and viewport
scale. No document text, identifiers or touch coordinates are recorded.

Verification covers full-width pulls, control taps versus swipes, back navigation
from the center and after scrolling, reload delegation, cancellation and device
exclusions. Browser checks must prove a new document boot, not merely a successful
API read. Physical iPad PWA behavior remains a separate device acceptance check.
