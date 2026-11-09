import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import { MarkHistory } from '@/components/bible/marks/MarkHistory';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import { DocumentMetadataHistory } from '@/components/ui/DocumentMetadataHistory';
import { TagHistory } from '@/components/ui/TagHistory';

// BUG-20261109-edit-history-links-on-every-screen: the owner chose to hide every edit-history entry point
// until one designed place for history exists. History is still recorded on the server; only the buttons
// that open it are gone, so the Bible reader and the working screens look as they did before 2026-11-09.

const owner = 'owner-1';
const generation = 'generation-1';
const restore = () => Promise.resolve();

describe('edit history entry points are hidden', () => {
  it('draws nothing above the Bible text where «История пометок» used to stand', () => {
    const { container } = render(<MarkHistory text={null} disabled={false}
      session={{ owner, bookId: 'ROM', generation, restore, isApplied: () => false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws no field, metadata or tag history button', () => {
    const { container } = render(<>
      <DocumentFieldHistory current="Title" disabled={false} session={{ owner, generation, prayerId: 'prayer-1', restore }} />
      <DocumentMetadataHistory<'title'> owner={owner} collection="councils" id="council-1" generation={generation}
        current={{ title: 'Council' }} disabled={() => false} labels={{ title: 'Title' }} prefix="councils.history"
        nullable={[]} describeValue={(_, value) => String(value)} onRestore={restore} />
      <TagHistory owner={owner} id="prayer-1" generation={generation} path="/api/history" tags={['hope']} disabled={false}
        identify={() => 'prayer-1'} select={() => []} onRestore={restore} />
    </>);
    expect(container).toBeEmptyDOMElement();
  });

  it('every component that opens edit history asks the one switch', () => {
    const appRoot = path.join(__dirname, '..', '..', 'app');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); }
        else if (/\.tsx$/.test(entry.name)) files.push(full);
      }
    };
    walk(appRoot);
    // A component opens edit history when it loads a history page itself: through the shared hook, through a request
    // typed with a history page, or through a request whose literal route is a `*-history` one. Each such call is one
    // opener, and a file must ask the switch at least once per opener. Pages that only pass a route to a history
    // component (`path=".../prayer-tag-history"`) are not openers: the component they mount is.
    const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;
    const openers = files.map((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const calls = count(source, /useOwnerHistory\s*[<(]/g) + count(source, /requestOwnerJson<[^>]*History/g)
        + count(source, /(?:requestOwnerJson|fetch)\(\s*[`'"][^`'"\n]*-history/g);
      return { file: path.relative(appRoot, file), openers: calls, guards: count(source, /editHistoryShown\(\)/g) };
    }).filter((entry) => entry.openers > 0);
    expect(openers.length).toBeGreaterThanOrEqual(15);
    expect(openers.filter((entry) => entry.guards < entry.openers)).toEqual([]);
  });
});
