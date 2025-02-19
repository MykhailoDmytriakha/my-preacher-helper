export function getInitialLanguage() {
  if (typeof document !== 'undefined') {
    return document.cookie.match(/lang=([^;]+)/)?.[1] || 'en';
  }
  return 'en';
} 