import { assessPlanReadiness } from '@/(pages)/(private)/sermons/[id]/plan/planReadiness';

import type { Sermon, Thought } from '@/models/models';

const thought = (id: string, outlinePointId?: string | null): Thought => ({
  id,
  text: `Thought ${id}`,
  tags: [],
  date: '2026-08-15',
  ...(outlinePointId === undefined ? {} : { outlinePointId }),
});

const sermonWith = (patch: Partial<Sermon>): Sermon => ({
  id: 'sermon-1',
  title: 'Test',
  verse: 'Ps 86',
  date: '2026-08-15',
  userId: 'user-1',
  thoughts: [],
  ...patch,
});

const kinds = (sermon: Sermon) => assessPlanReadiness(sermon).issues.map((issue) => issue.kind);

describe('assessPlanReadiness', () => {
  it('calls a sermon ready when every thought sits on a point and every point holds one', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1'), thought('t2', 'p2')],
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [{ id: 'p2', text: 'Main point' }],
        conclusion: [],
      },
    });

    expect(assessPlanReadiness(sermon)).toEqual({ ready: true, issues: [] });
  });

  it('reports both absences for an untouched sermon', () => {
    expect(kinds(sermonWith({}))).toEqual(['noThoughts', 'noPoints']);
  });

  it('reports unsorted thoughts and names how many', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1'), thought('t2', null), thought('t3')],
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [],
        conclusion: [],
      },
    });

    const { ready, issues } = assessPlanReadiness(sermon);
    expect(ready).toBe(false);
    expect(issues).toContainEqual({ kind: 'unassignedThoughts', count: 2 });
  });

  /**
   * The invisible case: the point was deleted, the thought still names it. Everything
   * LOOKS sorted, so nobody goes looking — and the thought never reaches the conspectus.
   */
  it('separates thoughts pointing at a point that no longer exists', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1'), thought('t2', 'deleted-point')],
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [],
        conclusion: [],
      },
    });

    const { issues } = assessPlanReadiness(sermon);
    expect(issues).toContainEqual({ kind: 'orphanThoughts', count: 1 });
    expect(issues.some((issue) => issue.kind === 'unassignedThoughts')).toBe(false);
  });

  it('reports points that hold no thoughts, naming the first few', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1')],
      outline: {
        introduction: [{ id: 'p1', text: 'Filled' }, { id: 'p2', text: 'Empty one' }],
        main: [{ id: 'p3', text: 'Empty two' }],
        conclusion: [{ id: 'p4', text: 'Empty three' }, { id: 'p5', text: 'Empty four' }],
      },
    });

    const { issues } = assessPlanReadiness(sermon);
    expect(issues).toContainEqual({
      kind: 'emptyPoints',
      count: 4,
      points: [
        { id: 'p2', section: 'introduction', position: 2, title: 'Empty one' },
        { id: 'p3', section: 'main', position: 1, title: 'Empty two' },
        { id: 'p4', section: 'conclusion', position: 1, title: 'Empty three' },
      ],
    });
  });

  it('stays silent about empty points when there are no points at all', () => {
    const sermon = sermonWith({ thoughts: [thought('t1', null)] });

    expect(kinds(sermon)).toEqual(['noPoints', 'unassignedThoughts']);
  });

  it('does not count a point as filled by a thought that names a deleted point', () => {
    // Both failures come from one thought: it is an orphan, and the point it should have
    // filled is therefore empty. Reporting only one of them would send the person to fix
    // half the problem.
    const sermon = sermonWith({
      thoughts: [thought('t1', 'deleted-point')],
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [],
        conclusion: [],
      },
    });

    const { issues } = assessPlanReadiness(sermon);
    expect(issues).toContainEqual({ kind: 'orphanThoughts', count: 1 });
    expect(issues).toContainEqual({
      kind: 'emptyPoints',
      count: 1,
      points: [{ id: 'p1', section: 'introduction', position: 1, title: 'Intro point' }],
    });
  });

  it('locates identically named points apart by section and position', () => {
    // Two points called the same thing is normal; "Intro Point, Intro Point" as a hint
    // is not. The pair has to be findable.
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1')],
      outline: {
        introduction: [{ id: 'p1', text: 'Same' }, { id: 'p2', text: 'Same' }],
        main: [{ id: 'p3', text: 'Same' }],
        conclusion: [],
      },
    });

    const issue = assessPlanReadiness(sermon).issues.find((i) => i.kind === 'emptyPoints');
    expect(issue?.points).toEqual([
      { id: 'p2', section: 'introduction', position: 2, title: 'Same' },
      { id: 'p3', section: 'main', position: 1, title: 'Same' },
    ]);
  });

  it('reports a point with a blank title by its place, not by an empty name', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1')],
      outline: {
        introduction: [{ id: 'p1', text: 'Filled' }, { id: 'p2', text: '   ' }],
        main: [],
        conclusion: [],
      },
    });

    const issue = assessPlanReadiness(sermon).issues.find((i) => i.kind === 'emptyPoints');
    expect(issue?.points).toEqual([{ id: 'p2', section: 'introduction', position: 2, title: '' }]);
  });

  it('does not accept a whitespace-only thought as material', () => {
    // It passes every count, then reaches the model as nothing — and the model invents.
    const sermon = sermonWith({
      thoughts: [{ ...thought('t1', 'p1'), text: '   ' }],
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [],
        conclusion: [],
      },
    });

    const { ready, issues } = assessPlanReadiness(sermon);
    expect(ready).toBe(false);
    expect(issues.map((i) => i.kind)).toEqual(['noThoughts', 'emptyPoints']);
  });

  it('treats a missing sermon as not ready rather than throwing', () => {
    expect(assessPlanReadiness(null).ready).toBe(false);
    expect(assessPlanReadiness(undefined).issues.map((i) => i.kind)).toEqual(['noThoughts', 'noPoints']);
  });

  it('handles an outline whose sections are absent', () => {
    const sermon = sermonWith({
      thoughts: [thought('t1', 'p1')],
      outline: { introduction: [{ id: 'p1', text: 'Only intro' }] } as never,
    });

    expect(assessPlanReadiness(sermon)).toEqual({ ready: true, issues: [] });
  });
});
