import fs from 'node:fs';
import path from 'node:path';

/**
 * ONE DOOR TO THE COUNCIL LIST. While the domain can run on either road, a screen that reads
 * councils straight from the legacy hook keeps showing the legacy list after the domain has moved
 * — a deleted council stays on that one screen, and the person cannot tell which screen is lying.
 * It has happened twice: the hub, breadcrumbs and calendar on 2026-09-13, and the dashboard, which
 * arrived with a merge of `main` on 2026-09-18. `useCouncilsRead` picks the road once.
 */
const appRoot = path.join(__dirname, '..', '..', 'app');
const ALLOWED = new Set([
  'hooks/useCouncilsRead.ts', // the door itself
  'hooks/useCouncils.ts', // the legacy hook and its single-council wrapper
  '(pages)/(private)/care/council/page.tsx', // the list page names both branches explicitly
]);

function sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('council readers', () => {
  it('reach the list only through useCouncilsRead', () => {
    const offenders = sources(appRoot)
      .filter(file => /import\s*\{[^}]*\buseCouncils\b[^}]*\}\s*from\s*['"]@\/hooks\/useCouncils['"]/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(appRoot, file).split(path.sep).join('/'))
      .filter(file => !ALLOWED.has(file));
    expect(offenders).toEqual([]);
  });
});
