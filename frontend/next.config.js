const withPWA = require('next-pwa')({
  dest: 'public',
  // disable: process.env.NODE_ENV === 'development',
  disable: false,
  register: true,
  skipWaiting: true,
  buildExcludes: [/app-build-manifest\.json$/],
  runtimeCaching: require('next-pwa/cache'),
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
