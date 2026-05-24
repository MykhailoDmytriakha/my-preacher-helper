const enableServiceWorkerInDev = process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER === 'true';
const shouldRegisterPWA = process.env.NODE_ENV !== 'development' || enableServiceWorkerInDev;

// Silence the harmless workbox dev warning ("GenerateSW has been called
// multiple times" - workbox issue #1790) even when something downstream
// still pulls in next-pwa. Patch is dev-only and only filters the one
// noisy line, so real warnings still surface.
if (process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('GenerateSW has been called multiple times')) {
      return;
    }
    originalWarn(...args);
  };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Enable Strict Mode to surface issues early
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
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'graph.facebook.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'pbs.twimg.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'platform-lookaside.fbsbx.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', port: '', pathname: '/**' },
    ],
  },
};

// Only pull in next-pwa + its workbox cache config when PWA is actually
// going to register. Calling `require('next-pwa')(...)` factory runs side
// effects that lead to the workbox warning even when `disable: true`, so
// in dev (default) we skip the import entirely.
if (!shouldRegisterPWA) {
  module.exports = nextConfig;
} else {
  const defaultRuntimeCaching = require('next-pwa/cache');
  const runtimeCaching = [
    {
      urlPattern: ({ url, request }) =>
        request.mode === 'navigate' && self.origin === url.origin,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'html-pages',
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
        networkTimeoutSeconds: 1,
      },
    },
    {
      urlPattern: ({ url }) =>
        self.origin === url.origin && url.searchParams.has('_rsc'),
      handler: 'NetworkFirst',
      options: {
        cacheName: 'rsc-payloads',
        expiration: { maxEntries: 128, maxAgeSeconds: 24 * 60 * 60 },
        networkTimeoutSeconds: 1,
      },
    },
    {
      urlPattern: ({ url }) =>
        self.origin === url.origin &&
        /^\/api\/sermons\/[^/]+\/plan$/.test(url.pathname),
      handler: 'NetworkOnly',
      method: 'GET',
      options: {
        cacheName: 'sermon-plan-generation',
      },
    },
    ...defaultRuntimeCaching.map((entry) => {
      if (!entry?.options?.cacheName) return entry;
      if (entry.options.cacheName === 'apis') {
        return {
          ...entry,
          options: {
            ...entry.options,
            expiration: { ...entry.options.expiration, maxEntries: 64 },
            networkTimeoutSeconds: 1,
          },
        };
      }
      if (entry.options.cacheName === 'others') {
        return {
          ...entry,
          options: {
            ...entry.options,
            expiration: { ...entry.options.expiration, maxEntries: 128 },
            networkTimeoutSeconds: 1,
          },
        };
      }
      return entry;
    }),
  ];

  const withPWA = require('next-pwa')({
    dest: 'public',
    disable: false, // gated above by shouldRegisterPWA
    register: true,
    skipWaiting: true,
    buildExcludes: [/app-build-manifest\.json$/],
    runtimeCaching,
    fallbacks: { document: '/offline.html' },
  });

  module.exports = withPWA(nextConfig);
}
