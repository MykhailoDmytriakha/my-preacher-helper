/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disable Strict Mode
  
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
