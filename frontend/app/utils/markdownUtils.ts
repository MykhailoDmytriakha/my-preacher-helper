/**
 * Utility functions for markdown content sanitization and processing
 */

/**
 * Sanitizes markdown content to prevent parsing errors in react-markdown
 * @param content - The markdown content to sanitize
 * @returns Sanitized markdown content
 */
export const sanitizeMarkdown = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Remove any null or undefined characters
  let sanitized = content.replace(/\0/g, '');
  
  // Fix common markdown formatting issues
  // Remove any malformed asterisk patterns that might cause parsing issues
  sanitized = sanitized.replace(/\*\*\*\*\*/g, '**'); // Fix multiple asterisks
  sanitized = sanitized.replace(/\*\*\*\*/g, '**'); // Fix triple asterisks
  
  // Ensure proper spacing around markdown elements
  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '**$1**'); // Fix bold formatting
  sanitized = sanitized.replace(/\*([^*]+)\*/g, '*$1*'); // Fix italic formatting
  
  // Remove any control characters that might cause issues
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  return sanitized.trim();
};

/**
 * Validates if content is safe to pass to react-markdown
 * @param content - The content to validate
 * @returns True if content is safe, false otherwise
 */
export const isValidMarkdownContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') {
    return false;
  }
  
  // Check for common problematic patterns
  const problematicPatterns = [
    /\*\*\*\*\*/, // Multiple asterisks
    /\*\*\*\*/, // Four asterisks
    /[\x00-\x1F\x7F]/, // Control characters
  ];
  
  return !problematicPatterns.some(pattern => pattern.test(content));
};
