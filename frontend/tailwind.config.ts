import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
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
