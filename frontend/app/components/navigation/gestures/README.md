# Page gestures

summary: iPad PWA touch refresh and back navigation, with existing data reconciliation and input protection.

`PageGestures` is mounted once in the private layout. It does not transform or
remount page content: fixed navigation, dialogs, scroll roots and editor focus
keep their existing layout and lifetime.

Both gestures are enabled only on iPad in installed standalone PWA mode, using
the shared `isIPadStandalonePwa` detector. Regular browser tabs, iPhone, Android
and desktop apps install no gesture listeners. Desktop-class iPad user agents
are recognized through Macintosh identification plus multiple touch points.

- Pull starts only at the top of the document, outside controls and nested
  scrollers. It follows the finger with resistance, arms at 72 visual pixels,
  and runs only on release. Pulling back below the threshold cancels it.
- `useDataRefresh` is the public data boundary. It refreshes mounted engine
  collections and observed documents through their existing readers. Active
  non-engine queries use their existing query functions. It never calls reload,
  router refresh, retry/save, or a direct transport from the UI.
- Engine reconciliation keeps unsent typing and manual forms pinned to their
  opening versions. A refresh is not a request to accept a remote conflict.
- One refresh runs at a time. Offline, failed reads and a 15-second timeout show
  a translated message. A timed-out read is not a failed write: its eventual
  response still follows the normal reconciliation rules.
- In the iPad PWA, a right swipe beginning within 28 pixels
  of the left edge navigates back after 90 pixels and only if history exists.
  That edge touch is claimed at touchstart to prevent double navigation.
  Browsers retain their own back gesture; the app adds no second handler there.
- Dialogs, focused fields, selected text, controls, drag handles, zoom and
  multi-touch keep their gestures. A route change or touch cancellation cancels
  an unfinished pull. Ordinary scrolling never changes into refresh halfway up.
- Motion respects reduced-motion preferences; status text is localized in all
  three languages and announced through a polite live region.

References used for the interaction contract:
[Apple gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/),
[Ionic refresher](https://ionicframework.com/docs/api/refresher),
[WebKit overscroll limitation](https://bugs.webkit.org/show_bug.cgi?id=275947).
CSS overscroll alone is not treated as proof that native refresh is suppressed.

Verification: gesture state and exclusion tests; real engine tests for clean
refresh, unsent draft preservation, read failure and closed subscriptions;
collection insertion discovery; facade tests for active versus inactive readers.
Browser touch emulation checks the rendered control and route changes. Physical
iPad Safari/Home Screen behavior remains a separate device acceptance check.
