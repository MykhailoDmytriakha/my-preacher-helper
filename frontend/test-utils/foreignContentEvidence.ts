import fs from 'fs';
import path from 'path';

/** Optional local evidence; ordinary test runs do not write artifacts. */
export function writeForeignEvidence(name: string, value: unknown) {
  const directory = process.env.FOREIGN_CONTENT_EVIDENCE;
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  }
}
