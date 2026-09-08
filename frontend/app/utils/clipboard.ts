/** Legacy plain-text transport shared by ordinary copy and the final rich-copy fallback. */
export function copyTextWithSelection(text: string): boolean {
  const textarea = document.createElement('textarea');
  const previousFocus = document.activeElement;
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  try {
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
}

/** A rejected modern write remains an error; legacy selection is for unavailable APIs. */
export async function copyPlainText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText === 'function' && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (!copyTextWithSelection(text)) throw new Error('Fallback copy failed');
}
