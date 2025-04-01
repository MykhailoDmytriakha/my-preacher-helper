import { getContrastColor } from "@utils/color";

/**
 * Check if a tag is a structure tag (Introduction, Main, Conclusion in any language)
 */
export const isStructureTag = (tag: string): boolean => {
  return tag.toLowerCase() === "intro" || 
         tag.toLowerCase() === "вступление" ||
         tag.toLowerCase() === "вступ" ||
         tag.toLowerCase() === "main" || 
         tag.toLowerCase() === "основная часть" ||
         tag.toLowerCase() === "основна частина" ||
         tag.toLowerCase() === "conclusion" || 
         tag.toLowerCase() === "заключение" ||
         tag.toLowerCase() === "висновок";
};

/**
 * Get default styling for tags without custom colors
 */
export const getDefaultTagStyling = (tag: string) => {
  if (tag.toLowerCase() === "intro" || tag.toLowerCase() === "вступление" || tag.toLowerCase() === "вступ") {
    return {
      bg: "bg-blue-100 dark:bg-blue-900",
      text: "text-blue-800 dark:text-blue-200"
    };
  } else if (tag.toLowerCase() === "main" || tag.toLowerCase() === "основная часть" || tag.toLowerCase() === "основна частина") {
    return {
      bg: "bg-purple-100 dark:bg-purple-900",
      text: "text-purple-800 dark:text-purple-200"
    };
  } else if (tag.toLowerCase() === "conclusion" || tag.toLowerCase() === "заключение" || tag.toLowerCase() === "висновок") {
    return {
      bg: "bg-green-100 dark:bg-green-900",
      text: "text-green-800 dark:text-green-200"
    };
  } else {
    return {
      bg: "bg-indigo-100 dark:bg-indigo-900",
      text: "text-indigo-800 dark:text-indigo-200"
    };
  }
};

/**
 * Get appropriate icon for structure tags
 */
export const getStructureIcon = (tag: string) => {
  const tagLower = tag.toLowerCase();
  
  // Introduction
  if (tagLower === "intro" || tagLower === "вступление" || tagLower === "вступ") {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
      className: "w-3.5 h-3.5 mr-1"
    };
  } 
  // Main Part
  else if (tagLower === "main" || tagLower === "основная часть" || tagLower === "основна частина") {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
      className: "w-3.5 h-3.5 mr-1"
    };
  } 
  // Conclusion
  else if (tagLower === "conclusion" || tagLower === "заключение" || tagLower === "висновок") {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 17 10 11 20 5"></polyline><line x1="4" y1="19" x2="12" y2="19"></line></svg>`,
      className: "w-3.5 h-3.5 mr-1"
    };
  }
  
  return null;
};

/**
 * Generate CSS styles for a tag
 */
export const getTagStyle = (tag: string, color?: string) => {
  const structureTagStatus = isStructureTag(tag);
  
  // Base class for all tags
  let className = "px-2 py-0.5 rounded-full flex items-center";
  
  // Enhanced styling for structure tags
  if (structureTagStatus) {
    className += " font-medium shadow-sm pl-1.5";
  }
  
  // Style based on whether we have color information
  let style: Record<string, string> = {};
  
  if (color) {
    // Use color info
    style = {
      backgroundColor: color,
      color: getContrastColor(color),
    };
    
    // Add border and darker shadow for structure tags
    if (structureTagStatus) {
      style.boxShadow = `0 1px 2px ${color}80`; // Add subtle shadow with 50% opacity
      style.border = `1px solid ${getContrastColor(color)}30`; // Very subtle border
    }
  } else {
    // Default styling handled through classes
    const defaultStyle = getDefaultTagStyling(tag);
    className += ` ${defaultStyle.bg} ${defaultStyle.text}`;
    
    // Add subtle border for structure tags
    if (structureTagStatus) {
      className += " border border-current border-opacity-20 shadow";
    }
  }
  
  return { className, style };
}; 