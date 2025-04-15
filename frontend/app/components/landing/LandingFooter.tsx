'use client';
import React from 'react';

const LandingFooter = () => {
  return (
    <footer className="py-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500 dark:text-gray-400">
        &copy; {new Date().getFullYear()} Preacher Helper
      </div>
    </footer>
  );
};

export default LandingFooter; 