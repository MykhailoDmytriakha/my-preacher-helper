// Base colors for sermon structure sections
// Introduction = Amber/Yellow, Main = Blue, Conclusion = Green
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
    darkHover: "hover:bg-amber-800/30",
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
    darkHover: "hover:bg-blue-800/30",
    text: "text-blue-800",
    darkText: "text-blue-200",
  },
  conclusion: {
    base: "#16a34a",       // Green-600
    light: "#22c55e",      // Green-500
    dark: "#15803d",       // Green-700
    bg: "bg-green-50",
    darkBg: "bg-green-900/30",
    border: "border-green-200",
    darkBorder: "border-green-800",
    hover: "hover:bg-green-100",
    darkHover: "hover:bg-green-800/30",
    text: "text-green-800",
    darkText: "text-green-200",
  }
};

// Helper function to get standard button/section styling
export function getSectionStyling(section: 'introduction' | 'mainPart' | 'conclusion') {
  const colors = SERMON_SECTION_COLORS[section];
  return {
    headerBg: `${colors.bg} dark:${colors.darkBg}`,
    headerHover: `${colors.hover} dark:${colors.darkHover}`,
    border: `${colors.border} dark:${colors.darkBorder}`,
    dragBg: `${colors.bg} dark:${colors.darkBg}`,
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