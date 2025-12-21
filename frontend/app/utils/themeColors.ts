// Base colors for sermon structure sections
// Introduction = Amber/Yellow, Main = Blue, Conclusion = Green
//
// IMPORTANT: When changing any color values here, also update tailwind.config.ts safelist!
// Tailwind CSS only generates CSS for classes that are statically found in code.
// Dynamic classes from variables need to be explicitly listed in safelist.
//
// Example: if you change darkBg: "bg-green-900/50" to darkBg: "bg-green-900/20",
// you MUST add 'dark:bg-green-900/20' to safelist in tailwind.config.ts

// Constants for repeated strings
const TEXT_WHITE = "text-white";

export const SERMON_SECTION_COLORS = {
  introduction: {
    base: "#d97706",       // Amber-600
    light: "#f59e0b",      // Amber-500
    dark: "#b45309",       // Amber-700
    bg: "bg-amber-50",
    darkBg: "bg-amber-900/40",
    border: "border-amber-200",
    darkBorder: "border-amber-800",
    hover: "hover:bg-amber-100",
    darkHover: "hover:bg-amber-900/40",
    text: "text-amber-800",
    darkText: "text-amber-200",
  },
  mainPart: {
    base: "#2563eb",       // Blue-600
    light: "#3b82f6",      // Blue-500
    dark: "#1d4ed8",       // Blue-700
    bg: "bg-blue-50",
    darkBg: "bg-blue-900/20",
    border: "border-blue-200",
    darkBorder: "border-blue-800",
    hover: "hover:bg-blue-100",
    darkHover: "hover:bg-blue-900/40",
    text: "text-blue-800",
    darkText: "text-blue-200",
  },
  conclusion: {
    base: "#16a34a",       // Green-600
    light: "#22c55e",      // Green-500
    dark: "#15803d",       // Green-700
    bg: "bg-green-50",
    darkBg: "bg-green-900/20",
    border: "border-green-200",
    darkBorder: "border-green-800",
    hover: "hover:bg-green-100",
    darkHover: "hover:bg-green-900/40",
    text: "text-green-800",
    darkText: "text-green-200",
  }
};

// Generic UI palette for non-section elements (avoid hardcoded colors)
export const UI_COLORS = {
  danger: {
    bg: "bg-rose-50",
    darkBg: "bg-rose-900/20",
    border: "border-rose-300",
    darkBorder: "border-rose-800",
    text: "text-rose-800",
    darkText: "text-rose-200",
  },
  muted: {
    text: "text-gray-500",
    darkText: "text-gray-400",
  },
  accent: {
    bg: "bg-violet-50",
    darkBg: "bg-violet-900/20",
    border: "border-violet-300",
    darkBorder: "border-violet-800",
    text: "text-violet-800",
    darkText: "text-violet-200",
  },
  success: {
    bg: "bg-green-50",
    darkBg: "bg-green-900/30",
    border: "border-green-300",
    darkBorder: "border-green-800",
    text: "text-green-800",
    darkText: "text-green-200",
  },
  highlight: {
    bg: "bg-amber-0/95",
    darkBg: "dark:bg-amber-0/100",
    text: "text-amber-900 dark:text-amber-950",
    ring: "ring-2 ring-amber-300/90 dark:ring-amber-200/90",
    weight: "font-semibold",
  },
  button: {
    primary: {
      bg: "bg-violet-600",
      hover: "hover:bg-violet-700",
      darkBg: "bg-violet-500",
      darkHover: "hover:bg-violet-400",
      text: TEXT_WHITE,
    },
    structure: {
      bg: "bg-amber-600",
      hover: "hover:bg-amber-700",
      darkBg: "bg-amber-500",
      darkHover: "hover:bg-amber-400",
      text: TEXT_WHITE,
    },
    plan: {
      bg: "bg-blue-600",
      hover: "hover:bg-blue-700",
      darkBg: "bg-blue-500",
      darkHover: "hover:bg-blue-400",
      text: TEXT_WHITE,
    },
    switcher: {
      gradient: "from-amber-500 to-blue-500",
      darkGradient: "from-amber-400 to-blue-400",
      border: "border-gray-200",
      darkBorder: "border-gray-700",
      bg: "bg-white",
      darkBg: "bg-gray-800",
      activeText: TEXT_WHITE,
      inactiveText: "text-gray-700",
      darkInactiveText: "text-gray-200",
    },
  },
  verseNumber: {
    // Extra subtle for superscript verse markers
    text: "text-gray-300",
    darkText: "text-gray-600",
  },
  neutral: {
    bg: "bg-gray-50",
    darkBg: "bg-gray-800",
    border: "border-gray-200",
    darkBorder: "border-gray-700",
    text: "text-gray-800",
    darkText: "text-gray-100",
  }
};

// Shared highlight token for search/result emphasis
export const HIGHLIGHT_COLORS = UI_COLORS.highlight;

// Timer control palette (centralized to avoid hardcoded colors in components)
export const TIMER_CONTROL_COLORS = {
  surface: {
    light: '#f8fafc',
    dark: '#0f172a',
  },
  border: {
    light: 'rgba(15, 23, 42, 0.08)',
    dark: 'rgba(255, 255, 255, 0.08)',
  },
  divider: {
    light: 'rgba(148, 163, 184, 0.35)',
    dark: 'rgba(75, 85, 99, 0.6)',
  },
  play: {
    start: SERMON_SECTION_COLORS.mainPart.light,
    end: SERMON_SECTION_COLORS.mainPart.base,
  },
  pause: {
    start: SERMON_SECTION_COLORS.introduction.light,
    end: SERMON_SECTION_COLORS.introduction.base,
  },
  resume: {
    start: SERMON_SECTION_COLORS.conclusion.light,
    end: SERMON_SECTION_COLORS.conclusion.base,
  },
  stop: {
    start: '#f43f5e', // Rose-500
    end: '#e11d48',   // Rose-600
  },
  skip: {
    start: '#a855f7', // Violet-500
    end: '#7c3aed',   // Violet-600
  },
  disabled: 'rgba(148, 163, 184, 0.45)',
} as const;

// Navigation item accent palettes (keep navigation styling consistent across workspaces)
const NAV_ITEM_THEMES = {
  default: {
    pill: 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40',
    menu: 'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40',
    indicator: 'text-blue-600 dark:text-blue-300'
  },
  studies: {
    pill: 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/30',
    menu: 'text-emerald-600 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/30',
    indicator: 'text-emerald-600 dark:text-emerald-200'
  }
} as const;

export type NavItemThemeKey = keyof typeof NAV_ITEM_THEMES;

export const getNavItemTheme = (key?: NavItemThemeKey) => NAV_ITEM_THEMES[key ?? 'default'];

// Helper function to get standard button/section styling
export function getSectionStyling(section: 'introduction' | 'mainPart' | 'conclusion') {
  const colors = SERMON_SECTION_COLORS[section];
  return {
    headerBg: `${colors.bg} dark:${colors.darkBg}`,
    headerHover: `${colors.hover} dark:${colors.darkHover}`,
    border: `${colors.border} dark:${colors.darkBorder}`,
    dragBg: `${colors.bg.split('-')[1] === 'amber' ? 'bg-amber-200 dark:bg-amber-700' : 
            colors.bg.split('-')[1] === 'blue' ? 'bg-blue-200 dark:bg-blue-700' : 
            'bg-green-200 dark:bg-green-700'}`,
    // Construct badge classes carefully
    badge: `${colors.bg.split('-')[1] === 'amber' ? 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-200' : 
            colors.bg.split('-')[1] === 'blue' ? 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200' : 
            'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200'}`
  };
}

// Helper function to get tag styling
export function getTagStyling(section: 'introduction' | 'mainPart' | 'conclusion') {
  const colors = SERMON_SECTION_COLORS[section];
  return {
    // Use a slightly transparent dark background for chips to reduce visual weight
    bg: `${colors.bg} dark:${colors.darkBg.split('/')[0]}/60`,
    text: `${colors.text} dark:${colors.darkText}`
  };
}

// Helper function to get Focus mode button colors
export function getFocusModeButtonColors(section: 'introduction' | 'mainPart' | 'conclusion') {
  // Map section to Tailwind color names
  const colorMap = {
    introduction: 'amber',
    mainPart: 'blue',
    conclusion: 'green'
  };
  const colorName = colorMap[section];
  return {
    bg: `bg-${colorName}-500`,
    hover: `hover:bg-${colorName}-600`,
    text: TEXT_WHITE
  };
} 
