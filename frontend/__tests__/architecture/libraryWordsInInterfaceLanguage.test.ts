import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * WHAT A LIBRARY SAYS TO A SCREEN READER IS SAID IN THE INTERFACE LANGUAGE
 * (BUG-20261006-library-screen-reader-words-english). The drag libraries and the calendar speak
 * their own English unless the app hands them its words: every `DndContext` gets `accessibility`
 * (`useDndKitAccessibility`), every `DragDropContext` gets `dragHandleUsageInstructions` and the
 * announcements (`usePangeaAnnouncements`), and a `DayPicker` gets the calendar's locale with its
 * labels (`useAppLocale().dayPickerLocale`), not a bare date-fns one.
 */
const APP = join(__dirname, '..', '..', 'app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : [];
  });
}

/** The opening tag of each element, up to its closing `>` at depth zero of braces. */
function openingTags(source: string, name: string): { index: number; tag: string }[] {
  const tags: { index: number; tag: string }[] = [];
  for (const match of source.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let depth = 0;
    let end = match.index!;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0 && source[end - 1] !== '=') break;
    }
    tags.push({ index: match.index!, tag: source.slice(match.index!, end + 1) });
  }
  return tags;
}

const files = sourceFiles(APP).map(path => ({ path: relative(APP, path), source: readFileSync(path, 'utf8') }));
const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

describe('library words reach the screen reader in the interface language', () => {
  it.each([
    ['DndContext', /\baccessibility=\{/],
    ['DragDropContext', /\bdragHandleUsageInstructions=\{/],
    ['DayPicker', /\blocale=\{dayPickerLocale\}/],
  ])('gives every %s its translated words', (name, required) => {
    const offenders = files.flatMap(({ path, source }) => openingTags(source, name)
      .filter(({ tag }) => !required.test(tag))
      .map(({ index }) => `${path}:${lineOf(source, index)}`));
    expect(offenders).toEqual([]);
  });

  it('announces pick up, move and drop on every DragDropContext', () => {
    const offenders = files.flatMap(({ path, source }) => openingTags(source, 'DragDropContext')
      .filter(({ tag }) => !/announceStart/.test(tag) || !/announceUpdate/.test(tag) || !/announceEnd/.test(tag))
      .map(({ index }) => `${path}:${lineOf(source, index)}`));
    expect(offenders).toEqual([]);
  });
});
