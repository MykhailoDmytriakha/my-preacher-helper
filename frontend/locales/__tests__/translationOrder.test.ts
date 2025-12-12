import * as fs from 'fs';
import * as path from 'path';

// More robust key extraction considering basic nesting (up to one level)
const getKeysWithNestingOrder = (filePath: string): string[] => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const keys: string[] = [];
    let currentParentKey: string | null = null;

    const keyRegex = /^\s*"([^"]+)"\s*:/;
    const objectStartRegex = /{\s*$/;
    const objectEndRegex = /^\s*},?$/;

    for (const line of lines) {
        const keyMatch = line.match(keyRegex);
        if (keyMatch) {
            const key = keyMatch[1];
            if (objectStartRegex.test(line)) {
                // This key opens a nested object
                keys.push(key);
                currentParentKey = key;
            } else if (currentParentKey) {
                // This is a key within a nested object
                keys.push(`${currentParentKey}.${key}`);
            } else {
                // This is a top-level key
                keys.push(key);
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