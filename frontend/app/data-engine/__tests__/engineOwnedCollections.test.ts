import { readFileSync } from 'fs';
import path from 'path';

import { isClosedToLegacyWriters, isCollectionServed, isLegacyOpen } from '../activation';
import { isCollectionOnEngine } from '../clientPolicy';
import { ENGINE_OWNED_COLLECTIONS } from '../engineOwnedCollections';

const SWITCHES = ['NEXT_PUBLIC_DATA_ENGINE_ENABLED', 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS', 'DATA_ENGINE_ENABLED', 'DATA_ENGINE_COLLECTIONS', 'DATA_ENGINE_CLOSED_COLLECTIONS'];

/** The list `closedToBrowserWrites` in the deployed rules refuses for every browser write. */
function rulesClosedCollections(): string[] {
  const rules = readFileSync(path.join(__dirname, '../../../firestore.rules'), 'utf8');
  const body = rules.match(/function closedToBrowserWrites\(name\)\s*\{\s*return name in \[([^\]]*)\]/);
  if (!body) throw new Error('closedToBrowserWrites not found in firestore.rules');
  return body[1].split(',').map(entry => entry.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

describe('collections the engine owns in code', () => {
  it('owns only collections the Firestore rules already close to browser writes', () => {
    expect(ENGINE_OWNED_COLLECTIONS.length).toBeGreaterThan(0);
    expect(rulesClosedCollections()).toEqual(expect.arrayContaining([...ENGINE_OWNED_COLLECTIONS]));
  });

  it('serves and closes every owned collection on a deployment with no switch set, in the browser and on the server', () => {
    for (const key of SWITCHES) expect(process.env[key]).toBeUndefined();
    for (const owned of ENGINE_OWNED_COLLECTIONS) {
      expect(isCollectionOnEngine(owned)).toBe(true);
      expect(isCollectionServed(owned)).toBe(true);
      expect(isClosedToLegacyWriters(owned)).toBe(true);
      expect(isLegacyOpen(owned)).toBe(false);
    }
  });
});
