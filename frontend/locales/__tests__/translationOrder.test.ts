import * as fs from 'fs';
import * as path from 'path';

// Helper function to extract keys from a JSON object while preserving order
// This simple approach works for flat JSON structures or when the order of nested keys doesn't matter.
// For complex nested structures where order matters at all levels, a more sophisticated parser might be needed.
const getKeysInOrder = (filePath: string): string[] => {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Use a regex to find all top-level keys in order.
  // This regex looks for quoted strings followed by a colon, which are likely keys.
  // It assumes keys don't contain escaped quotes or colons within the key itself.
  const keys: string[] = [];
  const regex = /"([^"]+)"\s*:/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    // Basic check to avoid matching keys within nested objects directly.
    // This could be improved for deeper nesting levels if needed.
    const preMatchIndex = match.index - 1;
    if (preMatchIndex >= 0 && content[preMatchIndex] === '\n' || content[preMatchIndex] === '{' || content[preMatchIndex] === ',') {
        keys.push(match[1]);
    }
    // A simpler but less precise way, capturing all keys including nested ones:
    // keys.push(match[1]);
  }

  // For a structured approach, parse the JSON and recursively extract keys.
  // However, standard JSON.parse doesn't guarantee order.
  // const data = JSON.parse(content);
  // const extractKeys = (obj: any, prefix = ''): string[] => {
  //   let keys: string[] = [];
  //   for (const key in obj) {
  //     if (Object.prototype.hasOwnProperty.call(obj, key)) {
  //       const newKey = prefix ? `${prefix}.${key}` : key;
  //       keys.push(newKey);
  //       if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
  //         keys = keys.concat(extractKeys(obj[key], newKey));
  //       }
  //     }
  //   }
  //   return keys;
  // };
  // return extractKeys(data);

  return keys;
};

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