import fs from 'fs';
import path from 'path';

/**
 * THE SPLITTER THAT PUT OLD SERMONS BACK ON THEIR POINTS.
 *
 * Sermons written before per-node cells hold the whole section as one assembled string —
 * but an assembled one: it still carries `## N. Title` per point, and the NUMBER says where
 * each block belongs. The first attempt dropped the whole section into the first point: it
 * kept every byte and lied about all of them, one card holding the entire sermon.
 *
 * This is a one-off migration script, so the function is loaded out of it rather than
 * exported — the test exists because the thing it guards is IRREVERSIBLE for the person
 * whose text it moves.
 */
const scriptSource = fs.readFileSync(
  path.join(__dirname, '../../scripts/migrate-plan-text.js'),
  'utf8'
);
const splitSource = /function splitAssembledSection[\s\S]*?\n}\n/.exec(scriptSource)![0];
// eslint-disable-next-line no-eval
const splitAssembledSection = eval(`(${splitSource.replace('function splitAssembledSection', 'function')})`) as (
  assembled: string,
  points: { id: string; text?: string }[]
) => { result: Record<string, string>; unmatched: string[]; matchedBy: Record<string, number> };

const points = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
const titled = [
  { id: 'p1', text: 'First' },
  { id: 'p2', text: 'Second' },
  { id: 'p3', text: 'Third' },
];

describe('splitAssembledSection', () => {
  it('sends each numbered block to the point its number names', () => {
    const { result } = splitAssembledSection(
      '## 1. First\n\nAlpha\n\n## 2. Second\n\nBeta\n\n## 3. Third\n\nGamma',
      points
    );
    expect(result).toEqual({ p1: 'Alpha', p2: 'Beta', p3: 'Gamma' });
  });

  it('drops the heading line — assembly prints it again from the structure', () => {
    const { result } = splitAssembledSection('## 1. First\n\nAlpha', points);
    expect(result.p1).toBe('Alpha');
    expect(result.p1).not.toContain('## 1.');
  });

  it('keeps text that appears before any heading, where it sat', () => {
    const { result } = splitAssembledSection('Opening words\n\n## 2. Second\n\nBeta', points);
    expect(result.p1).toBe('Opening words');
    expect(result.p2).toBe('Beta');
  });

  it('honours numbering that starts partway through', () => {
    // A real sermon: its conclusion began at `## 2.`, so point one holds no heading.
    const { result } = splitAssembledSection('## 2. Second\n\nBeta\n\n## 3. Third\n\nGamma', points);
    expect(result.p2).toBe('Beta');
    expect(result.p3).toBe('Gamma');
    expect(result.p1).toBeUndefined();
  });

  it('puts an unsplittable section into the first point rather than nowhere', () => {
    const { result } = splitAssembledSection('Just prose, no headings at all.', points);
    expect(result.p1).toBe('Just prose, no headings at all.');
  });

  /**
   * The case a stress run caught: numbering can outrun the structure when a point was
   * deleted after the text was assembled. Losing those words is not an option.
   */
  it('never loses a block whose number points past the last point', () => {
    const { result, unmatched } = splitAssembledSection(
      '## 1. First\n\nAlpha\n\n## 9. Ninth\n\nOrphaned words',
      [{ id: 'p1' }]
    );
    expect(result.p1).toContain('Alpha');
    expect(result.p1).toContain('Orphaned words');
    expect(unmatched).toHaveLength(1);
  });

  it('does nothing when there are no points to hold anything', () => {
    const { result } = splitAssembledSection('## 1. First\n\nAlpha', []);
    expect(result).toEqual({});
  });
});

/**
 * WHAT THE FOURTH REVIEW ROUND FOUND — each of these silently moved or hid real text.
 */
describe('splitAssembledSection matches by title', () => {
  it('handles headings with no number at all — the shape assembly actually writes', () => {
    // `buildSectionOutlineMarkdown` prints `## <point text>`, no number. Reading these as
    // "unnumbered, therefore point one" put an entire section into the first card.
    const { result } = splitAssembledSection(
      '## First\n\nAlpha\n\n## Second\n\nBeta\n\n## Third\n\nGamma',
      titled
    );
    expect(result).toEqual({ p1: 'Alpha', p2: 'Beta', p3: 'Gamma' });
  });

  it('follows the title when the numbering disagrees with it', () => {
    // Points reordered after the text was assembled: the numbers now name the wrong ones,
    // and trusting them swaps two points' text without a word.
    const reordered = [
      { id: 'p1', text: 'Grace' },
      { id: 'p2', text: 'Law' },
    ];
    const { result } = splitAssembledSection('## 1. Law\n\nLawText\n\n## 2. Grace\n\nGraceText', reordered);
    expect(result.p2).toBe('LawText');
    expect(result.p1).toBe('GraceText');
  });

  it('ignores a heading inside a fenced block — that is content, not structure', () => {
    const { result } = splitAssembledSection(
      '## First\n\nAlpha\n\n```md\n## Second\nnot a heading\n```\n\nstill alpha',
      titled
    );
    expect(result.p1).toContain('## Second');
    expect(result.p1).toContain('not a heading');
    expect(result.p1).toContain('still alpha');
    expect(result.p2).toBeUndefined();
  });

  it('does not treat a deeper heading as a point boundary', () => {
    const { result } = splitAssembledSection('## First\n\nAlpha\n\n### Sub\n\nDetail', titled);
    expect(result.p1).toContain('### Sub');
    expect(result.p1).toContain('Detail');
  });

  it('never gives one point away twice', () => {
    const { result, unmatched } = splitAssembledSection(
      '## First\n\nAlpha\n\n## First\n\nAlphaAgain',
      [{ id: 'p1', text: 'First' }, { id: 'p2', text: 'Second' }]
    );
    // The repeat cannot claim the same point; it must land somewhere and be reported.
    expect(result.p1).toBe('Alpha');
    expect(Object.values(result).join(' ')).toContain('AlphaAgain');
    expect(unmatched.length + Object.keys(result).length).toBeGreaterThan(1);
  });

  it('reports how each block was matched', () => {
    const { matchedBy } = splitAssembledSection('## First\n\nAlpha\n\n## 2. Nonsense\n\nBeta', titled);
    expect(matchedBy.title).toBe(1);
    expect(matchedBy.number).toBe(1);
  });
});

/**
 * WHAT THE FIFTH ROUND FOUND — both of these moved or copied real text.
 */
describe('splitAssembledSection: preamble and ambiguous titles', () => {
  it('lets a preamble share the first point without evicting its own heading', () => {
    // The regression: the preamble CLAIMED point one, so `## First` could no longer match
    // it, fell through to the last point, and dragged everything after it along.
    const { result } = splitAssembledSection(
      'Opening\n\n## First\n\nAlpha\n\n## Second\n\nBeta',
      [{ id: 'p1', text: 'First' }, { id: 'p2', text: 'Second' }]
    );
    expect(result.p1).toContain('Opening');
    expect(result.p1).toContain('Alpha');
    expect(result.p2).toBe('Beta');
  });

  it('tells apart two points that share a title, using the number', () => {
    // The app supports identically named points on purpose; the title alone cannot
    // distinguish them, and picking "first free" duplicated one point's text onto another.
    const { result } = splitAssembledSection(
      '## 2. Same\n\nBody for the second',
      [{ id: 'p1', text: 'Same' }, { id: 'p2', text: 'Same' }]
    );
    expect(result.p2).toBe('Body for the second');
    expect(result.p1).toBeUndefined();
  });

  it('keeps a repeated identical heading from taking one point twice', () => {
    const { result } = splitAssembledSection(
      '## 1. First\n\nAlpha\n\n## 1. First\n\nAlphaAgain',
      [{ id: 'p1', text: 'First' }, { id: 'p2', text: 'Second' }]
    );
    const all = Object.values(result).join(' ');
    expect(all).toContain('Alpha');
    expect(all).toContain('AlphaAgain');
    // Neither copy may be lost, and neither may be silently duplicated.
    expect(all.match(/AlphaAgain/g)).toHaveLength(1);
  });
});
