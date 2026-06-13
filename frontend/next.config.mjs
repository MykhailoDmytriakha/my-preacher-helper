import withSerwistInit from "@serwist/next";

// PWA / offline service worker is built by Serwist (successor to next-pwa).
// Enabled in production always; in dev only when NEXT_PUBLIC_ENABLE_SERVICE_WORKER
// is set (so `npm run dev` stays SW-free, `npm run dev:pwa` opts in). Verify the
// offline app-shell with `npm run preview:pwa` (next build && next start) — the SW
// is disabled in `next dev` by default.
const swDisabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER !== "true";

// Bust the precached offline shell per build so a deploy never serves a stale
// shell (the git SHA changes every prod build; falls back to a constant in dev).
const swRevision = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  // Do NOT reload on reconnect: it would call location.reload() on the window
  // 'online' event and blow away unsaved form/autosave state.
  reloadOnOnline: false,
  additionalPrecacheEntries: [{ url: "/~offline", revision: swRevision }],
  disable: swDisabled,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Enable Strict Mode to surface issues early

  // Build identity exposed to the client (used by the optional "Show version"
  // setting). VERCEL_GIT_COMMIT_SHA is provided on Vercel builds; falls back to
  // 'dev' locally. Lets us confirm a redeploy actually landed in production.
  env: {
    NEXT_PUBLIC_APP_VERSION: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },

  eslint: {
    // Block builds when ESLint finds issues
    ignoreDuringBuilds: true,
  },

  // Configure SWC and Babel to work together
  experimental: {
    forceSwcTransforms: true, // Force SWC transforms
  },

  // Allow SWC to handle font imports
  compiler: {
    styledComponents: true, // If you're using styled-components
  },

  // Configure allowed image domains for external images
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com", port: "", pathname: "/**" },
      { protocol: "https", hostname: "graph.facebook.com", port: "", pathname: "/**" },
      { protocol: "https", hostname: "pbs.twimg.com", port: "", pathname: "/**" },
      { protocol: "https", hostname: "platform-lookaside.fbsbx.com", port: "", pathname: "/**" },
      { protocol: "https", hostname: "avatars.githubusercontent.com", port: "", pathname: "/**" },
    ],
  },
};

export default withSerwist(nextConfig);
