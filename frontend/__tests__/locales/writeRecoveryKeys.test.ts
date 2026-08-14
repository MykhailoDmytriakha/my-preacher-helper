import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

/**
 * A translation key referenced from code but missing from a locale does not fail a
 * build, a type check or any component test — it renders the KEY ITSELF on screen.
 * That is exactly how `dashboard.due.noDate` reached the working tree during cleanup:
 * a hardcoded string was replaced with a key nobody had created.
 *
 * These tests are the cheap guard against that whole class: the three locales must
 * carry the same keys, and the ones the write-recovery contract depends on must exist
 * everywhere, because they are what a person reads when their text was refused.
 */
type Tree = Record<string, unknown>;

const flatten = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value as Tree, path)
      : [path];
  });

const read = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Tree)[part];
    return undefined;
  }, tree);

const LOCALES: Array<[string, Tree]> = [
  ['ru', ru as Tree],
  ['uk', uk as Tree],
];

// Every key the refusal path renders. If one of these is missing, a person whose write
// was refused reads a dotted identifier instead of an explanation.
const CONTRACT_KEYS = [
  'writeRecovery.refused',
  'writeRecovery.refusedChange',
  'buttons.retry',
  'freshness.copyTextAction',
  'common.saveError',
  'errors.thoughtUpdateError',
  'errors.failedToSaveThought',
];

describe('locales carry every key the write-recovery contract renders', () => {
  it.each(CONTRACT_KEYS)('%s exists in all three locales and is not empty', (key) => {
    for (const [name, tree] of [['en', en as Tree], ...LOCALES] as Array<[string, Tree]>) {
      const value = read(tree, key);
      // The locale name travels inside the assertion so a failure names WHICH language
      // is missing the key instead of just "expected string, got undefined".
      expect(`${name}:${typeof value}`).toBe(`${name}:string`);
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)('%s has no key that English is missing, and misses none of English', (_name, tree) => {
    const english = new Set(flatten(en as Tree));
    const locale = new Set(flatten(tree));
    // Plural suffixes differ by language by design (`_few`/`_many` exist only where the
    // language needs them), so compare on the base key instead of the exact suffix.
    const base = (key: string) => key.replace(/_(one|few|many|other|zero|two)$/, '');
    const englishBases = new Set([...english].map(base));
    const localeBases = new Set([...locale].map(base));

    expect([...englishBases].filter((key) => !localeBases.has(key))).toEqual([]);
    expect([...localeBases].filter((key) => !englishBases.has(key))).toEqual([]);
  });
});
