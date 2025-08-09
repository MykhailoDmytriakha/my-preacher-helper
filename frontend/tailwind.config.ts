import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Ensure dark variants generated for dynamic theme classes
    'dark:bg-amber-900/40',
    // Keep commonly used variations to avoid future misses
    'dark:bg-amber-900/30',
    'dark:bg-amber-900/20',
    // Tag chip backgrounds/texts
    'dark:bg-amber-900',
    'dark:bg-amber-900/60',
    'dark:text-amber-200',
    'dark:bg-blue-900/60',
    'dark:bg-green-900/60',
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      animation: {
        'fade-in-out': 'fadeInOut 3s ease-in-out',
        'slide-down': 'slideDown 0.2s ease-out forwards',
      },
      keyframes: {
        fadeInOut: {
          '0%': { opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideDown: {
          'from': { 
            transform: 'translateY(-10px)', 
            opacity: '0' 
          },
          'to': { 
            transform: 'translateY(0)', 
            opacity: '1' 
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config;
