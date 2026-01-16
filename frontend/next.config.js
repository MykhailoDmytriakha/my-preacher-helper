const defaultRuntimeCaching = require('next-pwa/cache');

const runtimeCaching = [
  {
    urlPattern: ({ url, request }) =>
      request.mode === 'navigate' && self.origin === url.origin,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'html-pages',
      expiration: {
        maxEntries: 64,
        maxAgeSeconds: 24 * 60 * 60,
      },
      networkTimeoutSeconds: 1,
    },
  },
  {
    urlPattern: ({ url }) =>
      self.origin === url.origin && url.searchParams.has('_rsc'),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'rsc-payloads',
      expiration: {
        maxEntries: 128,
        maxAgeSeconds: 24 * 60 * 60,
      },
      networkTimeoutSeconds: 1,
    },
  },
  ...defaultRuntimeCaching.map((entry) => {
    if (!entry?.options?.cacheName) {
      return entry;
    }

    if (entry.options.cacheName === 'apis') {
      return {
        ...entry,
        options: {
          ...entry.options,
          expiration: {
            ...entry.options.expiration,
            maxEntries: 64,
          },
          networkTimeoutSeconds: 1,
        },
      };
    }

    if (entry.options.cacheName === 'others') {
      return {
        ...entry,
        options: {
          ...entry.options,
          expiration: {
            ...entry.options.expiration,
            maxEntries: 128,
          },
          networkTimeoutSeconds: 1,
        },
      };
    }

    return entry;
  }),
];

const withPWA = require('next-pwa')({
  dest: 'public',
  // disable: process.env.NODE_ENV === 'development',
  disable: false,
  register: true,
  skipWaiting: true,
  buildExcludes: [/app-build-manifest\.json$/],
  runtimeCaching,
  fallbacks: {
    document: '/offline.html',
  },
});

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
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'graph.facebook.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'platform-lookaside.fbsbx.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = withPWA(nextConfig);
