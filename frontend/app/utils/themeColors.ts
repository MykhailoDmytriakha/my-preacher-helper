// Base colors for sermon structure sections
export const SERMON_SECTION_COLORS = {
  introduction: {
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
  mainPart: {
    base: "#7e22ce",       // Purple-700
    light: "#a855f7",      // Purple-500
    dark: "#6b21a8",       // Purple-800
    bg: "bg-purple-50",
    darkBg: "bg-purple-900/20",
    border: "border-purple-200",
    darkBorder: "border-purple-800",
    hover: "hover:bg-purple-100",
    darkHover: "hover:bg-purple-800/30",
    text: "text-purple-800",
    darkText: "text-purple-200",
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
    badge: `${colors.bg.split('-')[1] === 'blue' ? 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200' : 
            colors.bg.split('-')[1] === 'purple' ? 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200' : 
            'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200'}`
  };
}

// Helper function to get tag styling
export function getTagStyling(section: 'introduction' | 'mainPart' | 'conclusion') {
  const colors = SERMON_SECTION_COLORS[section];
  return {
    bg: `${colors.bg} dark:${colors.darkBg.split('/')[0]}`,
    text: `${colors.text} dark:${colors.darkText}`
  };
} 