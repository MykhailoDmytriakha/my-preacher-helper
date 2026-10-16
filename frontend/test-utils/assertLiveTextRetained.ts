/** Browser assertion for native typing, not jsdom's act-flushed event simulation. */
export function assertLiveTextRetained(selector: string, expected: string) {
  const field = document.querySelector(selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error('Expected a native text field');
  }
  const actual = field.value;
  if (actual !== expected) {
    let firstDifference = 0;
    while (firstDifference < expected.length && expected[firstDifference] === actual[firstDifference]) {
      firstDifference++;
    }
    throw new Error(`Typed text changed: expected ${expected.length} characters, retained ${actual.length}; first difference at ${firstDifference}`);
  }
  return { expectedLength: expected.length, retainedLength: actual.length };
}
