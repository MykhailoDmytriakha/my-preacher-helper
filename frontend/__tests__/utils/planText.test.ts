import {
  hasWrittenPlan,
  liveNodeIds,
  readPlanText,
  renderPlan,
  renderPlanFromSermon,
} from '@/utils/planText';
import { planFreshnessProjection } from '@/utils/sermonFreshnessProjection';

import type { Sermon } from '@/models/models';

/**
 * READING BOTH SHAPES IS WHAT MAKES THE CHANGE SHIPPABLE.
 *
 * Production and local run against the SAME database, so the new code goes out while the
 * stored data is still in the old shape. If reading did not understand the old form, the
 * first deploy would show empty plans; if it preferred the old form, edits made after the
 * move would be invisible. Both directions are held here.
 */

const outline = {
  introduction: [
    { id: 'p1', text: 'First point', subPoints: [{ id: 's1', text: 'Sub one', position: 1000 }] },
  ],
  main: [{ id: 'p2', text: 'Second point' }],
  conclusion: [],
};

describe('readPlanText', () => {
  it('reads the new shape when it is there', () => {
    const sermon = { outline, planText: { p1: 'Body one' } } as unknown as Sermon;
    expect(readPlanText(sermon)).toEqual({ p1: 'Body one' });
  });

  it('falls back to the old per-section cells, flattened', () => {
    const sermon = {
      outline,
      plan: {
        introduction: { outline: 'stale assembled text', outlinePoints: { p1: 'Old body', s1: 'Old sub' } },
        main: { outline: '', outlinePoints: { p2: 'Old main' } },
        conclusion: { outline: '' },
      },
    } as unknown as Sermon;

    expect(readPlanText(sermon)).toEqual({ p1: 'Old body', s1: 'Old sub', p2: 'Old main' });
  });

  it('prefers the new shape over the old one once a save has moved it', () => {
    const sermon = {
      outline,
      planText: { p1: 'New body' },
      plan: { introduction: { outline: '', outlinePoints: { p1: 'Old body' } }, main: { outline: '' }, conclusion: { outline: '' } },
    } as unknown as Sermon;

    expect(readPlanText(sermon).p1).toBe('New body');
  });

  it('survives a sermon with no plan at all', () => {
    expect(readPlanText({ outline } as unknown as Sermon)).toEqual({});
    expect(readPlanText(null)).toEqual({});
  });
});

describe('renderPlan', () => {
  it('assembles the document from structure and text, never from a stored copy', () => {
    const rendered = renderPlan(outline, { p1: 'Body one', s1: 'Sub body', p2: 'Main body' });

    expect(rendered.introduction).toContain('## First point');
    expect(rendered.introduction).toContain('Body one');
    expect(rendered.introduction).toContain('### Sub one');
    expect(rendered.main).toContain('Main body');
  });

  /**
   * The reason the assembled document is no longer stored: text belonging to a node that
   * was deleted used to keep printing its heading into the document people preach from.
   */
  it('ignores text whose node no longer exists', () => {
    const rendered = renderPlan(outline, { p1: 'Body one', ghost: 'Text of a deleted point' });

    expect(rendered.introduction).toContain('Body one');
    expect(rendered.introduction).not.toContain('Text of a deleted point');
    expect(rendered.main).not.toContain('Text of a deleted point');
  });

  it('renders an old-shape sermon identically, without touching storage', () => {
    const sermon = {
      outline,
      plan: {
        introduction: { outline: 'IGNORED stale copy', outlinePoints: { p1: 'Body one' } },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
    } as unknown as Sermon;

    const rendered = renderPlanFromSermon(sermon);
    expect(rendered.introduction).toContain('Body one');
    // The stored assembled string is no longer a source of anything.
    expect(rendered.introduction).not.toContain('IGNORED stale copy');
  });
});

describe('liveNodeIds', () => {
  it('collects points and sub-points alike', () => {
    expect(liveNodeIds(outline)).toEqual(new Set(['p1', 's1', 'p2']));
  });

  it('is empty for a sermon without a structure', () => {
    expect(liveNodeIds(undefined).size).toBe(0);
  });
});

describe('hasWrittenPlan', () => {
  it('is true when a live node holds text', () => {
    expect(hasWrittenPlan({ outline, planText: { p1: 'Body' } } as unknown as Sermon)).toBe(true);
  });

  it('is false when the only text belongs to nodes that are gone', () => {
    // The owner has exactly this sermon: three cells of text, zero points in the structure.
    const orphaned = {
      outline: { introduction: [], main: [], conclusion: [] },
      planText: { gone1: 'Text', gone2: 'More text' },
    } as unknown as Sermon;

    expect(hasWrittenPlan(orphaned)).toBe(false);
  });

  it('does not count whitespace as writing', () => {
    expect(hasWrittenPlan({ outline, planText: { p1: '   \n  ' } } as unknown as Sermon)).toBe(false);
  });
});

/**
 * A PLAN THAT EXISTS MUST NEVER DISAPPEAR ON DEPLOY DAY.
 *
 * Sermons written before per-node cells existed hold only the assembled string. Building
 * strictly from structure plus text would hand those back empty — and production and local
 * share one database, so that would be someone's finished plan gone from both.
 */
describe('legacy sermons keep their plan', () => {
  const legacy = {
    outline: { introduction: [{ id: 'p1', text: 'A point' }], main: [], conclusion: [] },
    plan: {
      introduction: { outline: 'A whole plan written long ago' },
      main: { outline: '' },
      conclusion: { outline: '' },
    },
  } as unknown as Sermon;

  it('shows the stored text when there is nothing to assemble from', () => {
    expect(renderPlanFromSermon(legacy).introduction).toBe('A whole plan written long ago');
  });

  it('counts as having a plan, so the router does not send people away', () => {
    expect(hasWrittenPlan(legacy)).toBe(true);
  });

  it('prefers assembled text once cells exist for that section', () => {
    const moved = {
      ...legacy,
      planText: { p1: 'The text, now under its node' },
    } as unknown as Sermon;

    const rendered = renderPlanFromSermon(moved).introduction;
    expect(rendered).toContain('The text, now under its node');
    expect(rendered).not.toContain('A whole plan written long ago');
  });
});

/**
 * PARTIAL MIGRATION MUST NEVER HIDE TEXT.
 *
 * A sermon converts one node at a time: saving one card writes one key. If reading treated
 * "the new field exists" as "the new field is complete", every node not yet saved would
 * disappear from the editor, the pulpit view and every export — the text still in storage,
 * simply no longer read. This is the exact state the owner's own sermons are in mid-move.
 */
describe('a half-moved sermon shows everything', () => {
  const halfMoved = {
    outline: {
      introduction: [{ id: 'p1', text: 'Point one' }, { id: 'p2', text: 'Point two' }],
      main: [], conclusion: [],
    },
    plan: {
      introduction: { outline: '', outlinePoints: { p1: 'Old A', p2: 'Old B' } },
      main: { outline: '' },
      conclusion: { outline: '' },
    },
    // Only p1 has been saved under the new shape so far.
    planText: { p1: 'New A' },
  } as unknown as Sermon;

  it('keeps the node that has not moved yet', () => {
    const text = readPlanText(halfMoved);
    expect(text.p1).toBe('New A');
    expect(text.p2).toBe('Old B');
  });

  it('renders both points, not just the migrated one', () => {
    const rendered = renderPlanFromSermon(halfMoved).introduction;
    expect(rendered).toContain('New A');
    expect(rendered).toContain('Old B');
    expect(rendered).not.toContain('Old A');
  });

  it('still reports the sermon as having a plan', () => {
    expect(hasWrittenPlan(halfMoved)).toBe(true);
  });
});

/**
 * FRESHNESS COMPARES THE READABLE PLAN, NOT ITS TRANSITIONAL STORAGE SHAPE.
 *
 * A migrated document can hold the same text twice: legacy `outlinePoints` plus the new
 * `planText` map. The screen can also materialize the merged old+new map while Firestore
 * keeps only the leaf keys written so far. Comparing raw `planText` therefore reports a
 * storage migration or an optimistic mirror as a foreign edit even though the readable
 * text is identical. `readPlanText` is the canonical form both sides already render from.
 */
describe('freshness projection: effective plan text', () => {
  const base = {
    outline: { introduction: [{ id: 'p1', text: 'A point' }], main: [], conclusion: [] },
    thoughts: [],
    plan: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
  };

  it('notices a change made only in the new field', () => {
    const before = planFreshnessProjection({ ...base, planText: { p1: 'First' } });
    const after = planFreshnessProjection({ ...base, planText: { p1: 'Second' } });
    expect(after.planText).not.toBe(before.planText);
  });

  it('still notices a change in the old fields', () => {
    const before = planFreshnessProjection(base);
    const after = planFreshnessProjection({
      ...base,
      plan: { ...base.plan, introduction: { outline: 'changed', outlinePoints: { p1: 'x' } } },
    });
    expect(after.plan).not.toBe(before.plan);
  });

  it('stays quiet when nothing moved', () => {
    const a = planFreshnessProjection({ ...base, planText: { p1: 'Same' } });
    const b = planFreshnessProjection({ ...base, planText: { p1: 'Same' } });
    expect(a.planText).toBe(b.planText);
  });

  it('stays quiet when migration only copies the same legacy text into planText', () => {
    const legacy = {
      ...base,
      plan: {
        ...base.plan,
        introduction: { outline: '', outlinePoints: { p1: 'Same readable paragraph' } },
      },
    };
    const before = planFreshnessProjection(legacy);
    const after = planFreshnessProjection({
      ...legacy,
      planText: { p1: 'Same readable paragraph' },
    });

    expect(after.planText).toBe(before.planText);
  });
});

/**
 * CLEARING A CELL IS A REAL EDIT, AND THE MERGE MUST RESPECT IT.
 *
 * The merge lays new keys over old ones. If an empty string were treated as "nothing to lay
 * over", deleting the text of a point would silently resurrect whatever the old field held —
 * the person clears a card, reloads, and the old paragraph is back.
 */
describe('an emptied cell stays empty', () => {
  const cleared = {
    outline: { introduction: [{ id: 'p1', text: 'A point' }], main: [], conclusion: [] },
    plan: {
      introduction: { outline: '', outlinePoints: { p1: 'The old paragraph' } },
      main: { outline: '' },
      conclusion: { outline: '' },
    },
    planText: { p1: '' },
  } as unknown as Sermon;

  it('does not resurrect the legacy text', () => {
    expect(readPlanText(cleared).p1).toBe('');
  });

  it('does not print the old paragraph in the document', () => {
    expect(renderPlanFromSermon(cleared).introduction).not.toContain('The old paragraph');
  });

  it('reports the sermon as having no written plan', () => {
    expect(hasWrittenPlan(cleared)).toBe(false);
  });
});

/**
 * THE LEGACY FALLBACK MUST NOT UNDO AN EDIT.
 *
 * It exists for sections never written under the new shape. If it also fired for a section
 * whose cells were deliberately emptied, clearing a card would bring yesterday's assembled
 * paragraph back on the next reload — the app arguing with the person.
 */
describe('clearing a section beats the legacy fallback', () => {
  const base = {
    outline: { introduction: [{ id: 'p1', text: 'A point' }], main: [], conclusion: [] },
    plan: {
      introduction: { outline: 'LEGACY ASSEMBLED TEXT', outlinePoints: { p1: 'old' } },
      main: { outline: '' }, conclusion: { outline: '' },
    },
  };

  it('stays empty once the cell has been written empty', () => {
    const cleared = { ...base, planText: { p1: '' } } as unknown as Sermon;
    expect(renderPlanFromSermon(cleared).introduction).not.toContain('LEGACY ASSEMBLED TEXT');
  });

  it('still falls back for a section that has no cells at all', () => {
    // The genuinely old shape: an assembled string and nothing to assemble from.
    const assembledOnly = {
      outline: base.outline,
      plan: {
        introduction: { outline: 'LEGACY ASSEMBLED TEXT' },
        main: { outline: '' }, conclusion: { outline: '' },
      },
      planText: {},
    } as unknown as Sermon;
    expect(renderPlanFromSermon(assembledOnly).introduction).toBe('LEGACY ASSEMBLED TEXT');
  });
});
