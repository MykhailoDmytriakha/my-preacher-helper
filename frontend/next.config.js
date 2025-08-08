/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disable Strict Mode
  eslint: {
    // Do not block production builds on ESLint errors
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
};

module.exports = nextConfig;
