import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import withSerwistInit from "@serwist/next";

import { APP_CODE_PRECACHE_BYTES, requireAppCodePrecache } from "./scripts/pwa-precache.mjs";

// PWA / offline service worker is built by Serwist (successor to next-pwa).
// Enabled in production always; in dev only when NEXT_PUBLIC_ENABLE_SERVICE_WORKER
// is set (`dev` and `dev:pwa` opt in; `dev:no-pwa` keeps it off). Verify the
// offline app-shell with `npm run preview:pwa` (next build && next start) — the SW
// is disabled in `next dev` by default.
const swDisabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER !== "true";

// Bust the precached offline shell per build so a deploy never serves a stale
// shell (the git SHA changes every prod build; falls back to a constant in dev).
const swRevision = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

// Keep the linked identity resources with the shell from the first worker
// activation. Leaving additionalPrecacheEntries unset would scan every public
// Bible/audio asset; keep this list explicit instead. Static icon revisions
// follow their bytes, while the generated manifest follows the shell build.
const appIconSources = [
  ["/favicon.ico", "app/favicon.ico"],
  ["/icons/favicon.svg", "public/icons/favicon.svg"],
  ["/icons/apple-touch-icon.png", "public/icons/apple-touch-icon.png"],
  ["/icons/icon-192.png", "public/icons/icon-192.png"],
  ["/icons/icon-512.png", "public/icons/icon-512.png"],
  ["/icons/icon-maskable-512.png", "public/icons/icon-maskable-512.png"],
];
const appShellPrecacheEntries = [
  { url: "/~offline", revision: swRevision },
  { url: "/manifest.webmanifest", revision: swRevision },
  ...appIconSources.map(([url, source]) => ({
    url,
    revision: createHash("sha256").update(readFileSync(new URL(source, import.meta.url))).digest("hex"),
  })),
];

// The production build wrapper runs route type generation in an isolated
// directory before starting Next.js and the strict TypeScript check in
// parallel. Keeping these switches opt-in means a direct `next build` retains
// Next.js's built-in type check.
const externalTypecheck = process.env.NEXT_EXTERNAL_TYPECHECK === "true";
const typegenDistDir = process.env.NEXT_TYPEGEN_DIST_DIR;

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // The initial HTML starts the one registration while the app code is still loading.
  register: false,
  // Seen-page Flight payloads and the precached shell own offline navigation.
  // The optional HTML helper duplicates those writes and throws on late offline fetches.
  cacheOnNavigation: false,
  // Do NOT reload on reconnect: it would call location.reload() on the window
  // 'online' event and blow away unsaved form/autosave state.
  reloadOnOnline: false,
  additionalPrecacheEntries: appShellPrecacheEntries,
  maximumFileSizeToCacheInBytes: APP_CODE_PRECACHE_BYTES,
  manifestTransforms: [requireAppCodePrecache],
  disable: swDisabled,
});

// The markdown rendering chain (react-markdown + remark/rehype and their unified/
// micromark/hast dependency closure) ships ESM only. Tests that unmock
// react-markdown to assert REAL rendered output need these transformed.
// jest.config.ts's own transformIgnorePatterns cannot do it: next/jest puts a
// blanket "/node_modules/" rule ahead of anything added there, so transpilePackages
// is the only lever — the same trick already used for music-metadata below.
const MARKDOWN_TEST_PACKAGES = [
  "@ungap/structured-clone",
  "bail",
  "ccount",
  "character-entities",
  "character-entities-html4",
  "character-entities-legacy",
  "character-reference-invalid",
  "comma-separated-tokens",
  "decode-named-character-reference",
  "devlop",
  "escape-string-regexp",
  "estree-util-is-identifier-name",
  "hast-util-from-parse5",
  "hast-util-parse-selector",
  "hast-util-raw",
  "hast-util-sanitize",
  "hast-util-to-jsx-runtime",
  "hast-util-to-parse5",
  "hast-util-whitespace",
  "hastscript",
  "html-url-attributes",
  "html-void-elements",
  "is-alphabetical",
  "is-alphanumerical",
  "is-decimal",
  "is-hexadecimal",
  "is-plain-obj",
  "longest-streak",
  "markdown-table",
  "mdast-util-find-and-replace",
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "mdast-util-gfm-autolink-literal",
  "mdast-util-gfm-footnote",
  "mdast-util-gfm-strikethrough",
  "mdast-util-gfm-table",
  "mdast-util-gfm-task-list-item",
  "mdast-util-mdx-expression",
  "mdast-util-mdx-jsx",
  "mdast-util-mdxjs-esm",
  "mdast-util-phrasing",
  "mdast-util-to-hast",
  "mdast-util-to-markdown",
  "mdast-util-to-string",
  "micromark",
  "micromark-core-commonmark",
  "micromark-extension-gfm",
  "micromark-extension-gfm-autolink-literal",
  "micromark-extension-gfm-footnote",
  "micromark-extension-gfm-strikethrough",
  "micromark-extension-gfm-table",
  "micromark-extension-gfm-tagfilter",
  "micromark-extension-gfm-task-list-item",
  "micromark-factory-destination",
  "micromark-factory-label",
  "micromark-factory-space",
  "micromark-factory-title",
  "micromark-factory-whitespace",
  "micromark-util-character",
  "micromark-util-chunked",
  "micromark-util-classify-character",
  "micromark-util-combine-extensions",
  "micromark-util-decode-numeric-character-reference",
  "micromark-util-decode-string",
  "micromark-util-encode",
  "micromark-util-html-tag-name",
  "micromark-util-normalize-identifier",
  "micromark-util-resolve-all",
  "micromark-util-sanitize-uri",
  "micromark-util-subtokenize",
  "micromark-util-symbol",
  "micromark-util-types",
  "parse-entities",
  "property-information",
  "react-markdown",
  "rehype-raw",
  "rehype-sanitize",
  "remark-gfm",
  "remark-parse",
  "remark-rehype",
  "remark-stringify",
  "space-separated-tokens",
  "stringify-entities",
  "trim-lines",
  "trough",
  "unified",
  "unist-util-is",
  "unist-util-position",
  "unist-util-stringify-position",
  "unist-util-visit",
  "unist-util-visit-parents",
  "vfile",
  "vfile-location",
  "vfile-message",
  "web-namespaces",
  "zwitch",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Enable Strict Mode to surface issues early
  ...(typegenDistDir ? { distDir: typegenDistDir } : {}),

  // The dev server drops a compiled route after 60 s without requests and compiles it again on the
  // next one: after a pause, the requests of a returning tab took 16 s each (2026-10-14), past the
  // client's 5–8 s deadlines, so the app read them as "not reached" and said it was offline
  // (BUG-20261014-offline-banner-after-idle-tab). Routes stay compiled for a day; production has
  // nothing to compile and ignores this.
  ...(process.env.NODE_ENV === "development"
    ? { onDemandEntries: { maxInactiveAge: 24 * 60 * 60 * 1000, pagesBufferLength: 1000 } }
    : {}),

  typescript: {
    ignoreBuildErrors: externalTypecheck,
    ...(typegenDistDir ? { tsconfigPath: "tsconfig.build.json" } : {}),
  },

  // next/jest only transforms ESM dependencies listed here. Keep this test-only
  // so parser integration tests can unmock music-metadata and execute its real
  // dependency graph without changing production bundling behavior.
  transpilePackages: process.env.NODE_ENV === "test" ? [
    "music-metadata",
    "strtok3",
    "token-types",
    "@tokenizer/token",
    "@tokenizer/inflate",
    "uint8array-extras",
    "file-type",
    "@borewit/text-codec",
    "win-guid",
    ...MARKDOWN_TEST_PACKAGES,
  ] : [],

  // Build identity exposed to the client (used by the optional "Show version"
  // setting). VERCEL_GIT_COMMIT_SHA is provided on Vercel builds; falls back to
  // 'dev' locally. Lets us confirm a redeploy actually landed in production.
  env: {
    NEXT_PUBLIC_APP_VERSION: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_APP_WORKER_ENABLED: swDisabled ? "false" : "true",
    // Always defined, so the build can fold the test-login condition away (utils/testLogin.ts):
    // an unset NEXT_PUBLIC_ variable stays in the bundle as a runtime lookup, and the test
    // account's credentials would ship with it. "true" only where a Preview opted in.
    NEXT_PUBLIC_ENABLE_TEST_LOGIN: process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN === "true" ? "true" : "false",
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

  // The shared-note preview card (app/(pages)/share/notes/[token]/opengraph-image.tsx) reads
  // its Cyrillic fonts from disk at request time; on Vercel a serverless function only ships
  // what the build traced, so the font files are named here rather than trusted to tracing.
  outputFileTracingIncludes: {
    "/share/notes/[token]/opengraph-image": ["./assets/fonts/**/*"],
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
