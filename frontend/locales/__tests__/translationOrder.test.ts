import * as fs from 'fs';
import * as path from 'path';

// Plural suffixes that vary by language - normalize them for ordering comparison
const PLURAL_SUFFIXES = ['_one', '_other', '_few', '_many', '_zero', '_two'];

function normalizePluralKey(key: string): string {
    for (const suffix of PLURAL_SUFFIXES) {
        if (key.endsWith(suffix)) {
            return key.slice(0, -suffix.length);
        }
    }
    return key;
}

// More robust key extraction considering basic nesting (up to one level)
const getKeysWithNestingOrder = (filePath: string): string[] => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const keys: string[] = [];
    const seen = new Set<string>();
    let currentParentKey: string | null = null;

    const keyRegex = /^\s*"([^"]+)"\s*:/;
    const objectStartRegex = /{\s*$/;
    const objectEndRegex = /^\s*},?$/;

    for (const line of lines) {
        const keyMatch = line.match(keyRegex);
        if (keyMatch) {
            const rawKey = keyMatch[1];
            if (objectStartRegex.test(line)) {
                // This key opens a nested object
                keys.push(rawKey);
                seen.add(rawKey);
                currentParentKey = rawKey;
            } else if (currentParentKey) {
                // This is a key within a nested object — normalize plural suffix
                const normalizedLeaf = normalizePluralKey(rawKey);
                const fullKey = `${currentParentKey}.${normalizedLeaf}`;
                if (!seen.has(fullKey)) {
                    keys.push(fullKey);
                    seen.add(fullKey);
                }
            } else {
                // This is a top-level key
                const normalized = normalizePluralKey(rawKey);
                if (!seen.has(normalized)) {
                    keys.push(normalized);
                    seen.add(normalized);
                }
            }
        }

        if (objectEndRegex.test(line)) {
            // Exiting a nested object
            currentParentKey = null;
        }
    }

    return keys;
};

describe('Translation Files Key Order', () => {
  const localesDir = path.resolve(__dirname, '../'); // Navigate up to the locales directory
  const enFilePath = path.join(localesDir, 'en', 'translation.json');
  const ruFilePath = path.join(localesDir, 'ru', 'translation.json');
  const ukFilePath = path.join(localesDir, 'uk', 'translation.json');

  it('should have the same key order in all translation files', () => {
    const enKeys = getKeysWithNestingOrder(enFilePath);
    const ruKeys = getKeysWithNestingOrder(ruFilePath);
    const ukKeys = getKeysWithNestingOrder(ukFilePath);

    // Log keys for debugging if needed
    // console.log('EN Keys:', enKeys);
    // console.log('RU Keys:', ruKeys);
    // console.log('UK Keys:', ukKeys);

    // Enforce strict order: keys (including nested order markers) must appear in the same order
    expect(ruKeys).toEqual(enKeys);
    expect(ukKeys).toEqual(enKeys);
  });
}); 