export function getShareNotePath(token: string): string {
  const safeToken = encodeURIComponent(token);
  return `/share/notes/${safeToken}`;
}

export function getShareNoteUrl(token: string): string {
  const path = getShareNotePath(token);
  if (typeof window === 'undefined') {
    return path;
  }
  return `${window.location.origin}${path}`;
}
