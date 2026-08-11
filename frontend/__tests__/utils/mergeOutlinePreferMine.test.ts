import { mergeOutline } from '@/utils/mergeOutline';

import type { SermonOutline } from '@/models/models';

/**
 * DELETING A POINT MUST STAY DELETED WHERE NOBODY CAN BE ASKED.
 *
 * The merge treats "deleted here, rewritten there" as a collision and keeps THEIR
 * version — right for the plan editor, which stores the refusal and asks the person
 * to choose. The other four views have no such surface: they merge with
 * `preferMine`, which only silenced the exception, so their result still carried the
 * other device's point. The person deleted it and, after saving, it was back.
 *
 * That is worse than what existed before merging: a whole-field overwrite did honour
 * the deletion. Hence the flag — and the cost, taken knowingly: if the other device
 * rewrote that very point, its words are dropped. That is what "my decision wins"
 * means, and it is exactly what the old overwrite did anyway.
 */
const point = (id: string, text: string) => ({ id, text });

const outline = (main: Array<{ id: string; text: string }>): SermonOutline => ({
  introduction: [],
  main,
  conclusion: [],
});

describe('preferMine honours a local deletion', () => {
  const base = outline([point('p1', 'Grace'), point('p2', 'Mercy')]);
  // This screen deleted p1.
  const mine = outline([point('p2', 'Mercy')]);
  // The other device rewrote the very point being deleted.
  const theirs = outline([point('p1', 'Grace, rewritten on the phone'), point('p2', 'Mercy')]);

  it('drops the deleted point instead of resurrecting it', () => {
    const { outline: merged } = mergeOutline(base, mine, theirs, true);

    expect(merged.main.map((p) => p.id)).not.toContain('p1');
    // The untouched point is still there — deletion must not cost anything else.
    expect(merged.main.map((p) => p.id)).toContain('p2');
  });

  it('still reports the collision, so a caller that CAN ask is free to', () => {
    const { collisions } = mergeOutline(base, mine, theirs, true);

    expect(collisions).toContain('p1');
  });

  it('leaves the default behaviour untouched — their version wins and it is a collision', () => {
    // The plan editor depends on exactly this: it shows the choice instead of deciding.
    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toContain('p1');
    expect(merged.main.find((p) => p.id === 'p1')?.text).toBe('Grace, rewritten on the phone');
  });
});
