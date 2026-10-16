import { SCRIPTURE_LINK_MARK } from '@/components/bible/ScriptureLinks';
import { copyTextWithSelection } from '@/utils/clipboard';
import { debugLog } from "@/utils/debugMode";

/** The plan's markup with its reference links back as their words: a document gets text, not buttons. */
function withReferencesAsWords(element: HTMLElement): string {
  if (!element.querySelector(`[${SCRIPTURE_LINK_MARK}]`)) return element.innerHTML ?? '';
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(`[${SCRIPTURE_LINK_MARK}]`).forEach((link) => link.replaceWith(document.createTextNode(link.textContent ?? '')));
  return copy.innerHTML;
}

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
  const htmlContent = withReferencesAsWords(element);

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
      return true;
    }
  } catch (error) {
    debugLog("Plan copy failed: execCommand(html) branch", { error });
  } finally {
    selection?.removeAllRanges();
    tempContainer.remove();
  }

  return copyTextWithSelection(plainText);
}
