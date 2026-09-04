# My Preacher Helper as an installed web app

## Installation

Open the site in a supported browser while online. Installation does not copy all
sermons to the device or change the Firestore account.

- Chrome / Edge desktop: use the install icon in the address bar, or the browser's
  install-app menu command. Confirm the app name, then launch it from the OS launcher.
- Chrome Android: open the browser menu and choose **Install app** (wording can vary).
- Safari iPhone / iPad: **Share → Add to Home Screen**; enable **Open as Web App** if
  offered, then add. Launch the new icon.
- Safari Mac: **File → Add to Dock**.

An ordinary browser tab remains supported; installation is optional. Browser and
operating-system versions control which installation commands are available.
An installed iOS web app can have a separate login session from Safari; sign in
inside the installed app if prompted. This does not create a different cloud account.

## Offline and updates

Visit the required sermon or note while online before relying on it offline. The
existing Serwist worker caches app code, Firestore and React Query persist local
data, and the existing outbox handles guarded writes. Uncached data cannot be
downloaded offline. AI generation, transcription and cloud services still need a
connection. A cache is not a backup; do not clear site data while edits are pending.

App updates and record synchronization are separate. The existing update button
offers a restart after a proven version difference; reconnecting must not reload
the page. No new storage, push subscription or automatic reload is added here.
Finish and save open manual-entry forms before choosing the restart/update action.
Merely receiving an update must not discard the text currently being typed.

## Developer contract

- `app/manifest.ts`: stable ID `/`, start `/`, scope `/`, standalone display.
- Install identity is brand-only and deliberately not localized: `My Preacher Helper`,
  `Preacher Helper` (manifest `name`/`short_name`, `metadata.title`, Apple web-app
  title). A manifest is one build-time file per origin and an installed app keeps its
  identity, so the three-locale rule cannot apply to it; the product already writes the
  brand in Latin in all three locales (the landing title in
  `locales/{en,ru,uk}/translation.json`). Do not add translatable copy such as a
  `description` to the manifest.
- `app/layout.tsx`: Apple web-app metadata and browser theme; zoom remains enabled.
- `public/icons/`: square PNGs for Chromium and Apple, plus a separately padded
  maskable PNG. Generated from the existing emblem with
  `node scripts/generate-pwa-icons.mjs` from `frontend`.
- `app/sw.ts` and `next.config.mjs`: existing Serwist registration/caching owners.

Use a production build for offline QA, not hot-reloading development assets:

```sh
npm run test:coverage && npm run lint:full
NEXT_PUBLIC_API_BASE='' npm run build
cd frontend
npm run start -- --hostname 127.0.0.1 --port 3100
```

The empty API base is a local QA override so requests use the current origin.
Do not reuse a development environment value pinned to `http://localhost:3000`
when testing another port or a device. It does not alter deployment settings.

Verify the served HTML contains one manifest link; the manifest and every icon
return 200 with the right MIME types; Chromium reports no installability errors.
Install via browser UI, launch from the OS, and check `display-mode: standalone`.
Use a disposable record in the authorized test account for offline edit, reload,
reconnect, and update tests. Verify the rendered text and the server-accepted state,
not only IndexedDB contents. Record real OS-emulator installation separately from
desktop mobile-viewport emulation. Recheck on physical Android and iOS before
claiming physical-device support; simulator results do not prove physical-device
or Google OAuth behavior. See [the current QA record](pwa-qa.md) for tested scope.
