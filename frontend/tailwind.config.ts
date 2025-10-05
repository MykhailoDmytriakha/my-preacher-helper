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
    'dark:bg-green-900/20',
    // Dark hover backgrounds used in menus
    'dark:hover:bg-amber-900/40',
    'dark:hover:bg-blue-900/40',
    'dark:hover:bg-green-900/40',
    // Landing gradient overrides for dark mode
    'dark:from-blue-900/50',
    'dark:to-green-900/50',
    'dark:hover:from-blue-900',
    'dark:hover:to-green-900',
    // Accent (violet) palette used via dynamic UI_COLORS; keep both light/dark variants
    'bg-violet-50',
    'dark:bg-violet-900/20',
    'border-violet-300',
    'dark:border-violet-800',
    'text-violet-800',
    'dark:text-violet-200',
    // Neutral palette used via dynamic UI_COLORS in prep steps
    'bg-gray-50',
    'dark:bg-gray-800',
    'border-gray-200',
    'dark:border-gray-700',
    'text-gray-800',
    'dark:text-gray-100',
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config;
