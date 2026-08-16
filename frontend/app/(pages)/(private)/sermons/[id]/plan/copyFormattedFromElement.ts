import { debugLog } from "@/utils/debugMode";

/**
 * COPYING THE PLAN WITH ITS FORMATTING — one implementation, both editors.
 *
 * It lived inside the paired screen as a local callback, so the hand-written screen was
 * handed a no-op instead: its Copy button looked enabled, did nothing, and said nothing.
 *
 * Four attempts in order, because clipboard support is uneven and a preacher on an old
 * phone still expects the button to work: rich `ClipboardItem` write, plain `writeText`,
 * `execCommand` over a hidden element that keeps the markup, and finally plain text.
 */
export async function copyFormattedFromElement(element: HTMLDivElement | null): Promise<boolean> {
  if (!element) {
    return false;
  }

  const plainText = element.innerText ?? '';
  const htmlContent = element.innerHTML ?? '';

  const advancedClipboardAvailable =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    'ClipboardItem' in window;

  try {
    if (advancedClipboardAvailable) {
      const clipboardWindow = window as typeof window & { ClipboardItem: typeof ClipboardItem };
      const clipboardItem = new clipboardWindow.ClipboardItem({
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' })
      });
      await navigator.clipboard.write([clipboardItem]);
      return true;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(plainText);
      return true;
    }
  } catch (error) {
    debugLog("Plan copy failed: ClipboardItem/write branch", { error });
  }

  const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
  const range = document.createRange();
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'fixed';
  tempContainer.style.pointerEvents = 'none';
  tempContainer.style.opacity = '0';
  tempContainer.style.zIndex = '-1';
  tempContainer.innerHTML = htmlContent || plainText;
  document.body.appendChild(tempContainer);

  try {
    range.selectNodeContents(tempContainer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (document.execCommand('copy')) {
      selection?.removeAllRanges();
      document.body.removeChild(tempContainer);
      return true;
    }
  } catch (error) {
    debugLog("Plan copy failed: execCommand(html) branch", { error });
  } finally {
    selection?.removeAllRanges();
    document.body.removeChild(tempContainer);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = plainText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (error) {
    debugLog("Plan copy failed: execCommand(text) branch", { error });
  }

  return false;
}
