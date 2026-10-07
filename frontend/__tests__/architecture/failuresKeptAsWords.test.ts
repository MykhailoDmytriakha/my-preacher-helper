import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A FAILURE A SCREEN KEEPS IS KEPT AS WORDS, NOT AS A SENTENCE.
 *
 * A screen that stores `t('…')` in its error state, or throws `new Error(t('…'))` that a catch later
 * shows, freezes the sentence in the language it was said in: switch the language and the error on
 * screen stays in the old one (BUG-20261006-screen-error-kept-as-translated-sentence). Keep a key or
 * `FailureWords` and say it when shown — `sayFailure`, `saidError` + `refusalMessage`
 * (.howto/show-an-error-once.md). A toast is said once, at the moment, and is not this.
 *
 * Two checks. The direct form (`setError(t(…))`, `throw new Error(t(…))`) is easy to see; the same
 * sentence also arrived through a variable, a ternary or a helper, which no pattern of the call
 * catches. So the second check is on the state itself: an error, failure, notice or warning kept in
 * React state is not a string.
 */
const APP = join(__dirname, '..', '..', 'app');
const SET_SENTENCE = /\bset[A-Za-z]*(?:Error|Failure|Warning|Notice)\(\s*(?:i18n\.)?t\(/g;
const THROW_SENTENCE = /\bthrow new Error\(\s*(?:i18n\.)?t\(/g;
const STRING_STATE = /const \[(\w+), set\w+\] = (?:React\.)?useState(?:<string(?: \| null)?>\((?:null|''|"")?\)|\((?:''|"")\))/g;
const FAILURE_NAME = /(?:Error|Failure|Notice|Warning)$|^(?:error|failure|notice|warning)$/;

/**
 * Known, and each with its reason. The recorder hands its parent a translated sentence
 * (`FocusRecorderButton` `onError(message)`, `transcriptionError: string`) and the dictation states
 * around it keep it; changing that contract is its own work: BUG-20261006-recorder-error-channel-keeps-sentence.
 */
const RECORDER = 'BUG-20261006-recorder-error-channel-keeps-sentence';
const KNOWN: Record<string, { names: string[]; direct?: boolean; why: string }> = {
  [join('components', 'column', 'audio.ts')]: { names: [], direct: true, why: RECORDER },
  [join('components', 'Column.tsx')]: { names: ['sectionAudioError', 'normalAudioError'], why: RECORDER },
  [join('components', 'sermon', 'ScratchPanel.tsx')]: { names: ['voiceError'], why: RECORDER },
  [join('components', 'audio-recorder', 'useAudioRecorderLifecycle.ts')]: { names: ['transcriptionErrorState'], why: RECORDER },
  [join('hooks', 'useTextDictation.ts')]: { names: ['error'], why: RECORDER },
  [join('(pages)', '(private)', 'studies', '[id]', 'page.tsx')]: { names: ['voiceError'], why: RECORDER },
  [join('(pages)', '(private)', 'sermons', '[id]', 'page.tsx')]: { names: ['transcriptionError'], why: RECORDER },
  // An exception's own message for the caller to word; nothing translated is kept.
  [join('hooks', 'useClipboard.ts')]: { names: ['error'], why: 'raw message' },
  // Holds a translation key ('common.saveError'), said where it is shown.
  [join('(pages)', '(private)', 'studies', '[id]', 'useNoteAutoSave.ts')]: { names: ['saveError'], why: 'a key' },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

const files = sourceFiles(APP).map(path => ({ path: relative(APP, path), source: readFileSync(path, 'utf8') }));
const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

describe('failures a screen keeps are kept as words', () => {
  it('stores no translated sentence in an error state and throws none for a catch to show', () => {
    const offenders = files
      .filter(({ path }) => !KNOWN[path]?.direct)
      .flatMap(({ path, source }) => [...source.matchAll(SET_SENTENCE), ...source.matchAll(THROW_SENTENCE)]
        .map(match => `${path}:${lineOf(source, match.index ?? 0)} ${match[0]}`));
    expect(offenders).toEqual([]);
  });

  it('keeps no error, failure, notice or warning state as a string', () => {
    const offenders = files.flatMap(({ path, source }) => [...source.matchAll(STRING_STATE)]
      .filter(match => FAILURE_NAME.test(match[1]) && !KNOWN[path]?.names.includes(match[1]))
      .map(match => `${path}:${lineOf(source, match.index ?? 0)} ${match[1]}`));
    expect(offenders).toEqual([]);
  });

  it('lists no exception that no longer exists', () => {
    const stale = Object.entries(KNOWN).flatMap(([path, { names, direct }]) => {
      const file = files.find(entry => entry.path === path);
      if (!file) return [`${path}: file is gone`];
      const states = new Set([...file.source.matchAll(STRING_STATE)].map(match => match[1]));
      const gone = names.filter(name => !states.has(name)).map(name => `${path}: ${name} is no longer a string state`);
      const directGone = direct && ![...file.source.matchAll(SET_SENTENCE)].length ? [`${path}: no direct sentence left`] : [];
      return [...gone, ...directGone];
    });
    expect(stale).toEqual([]);
  });
});
