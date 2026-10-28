/**
 * WHETHER A KEY WAS PRESSED WHILE TYPING — in a field, a text area or an editable surface (the notes' editor). A screen's
 * own keys — arrows between notes, a board's undo, a focused card's Escape — leave such a key to the text it went to.
 */
export function isTypingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}
