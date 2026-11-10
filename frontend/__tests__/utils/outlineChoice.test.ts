import { chooseOutlineLocalChanges, readOutlineTextChoice } from '@/utils/outlineChoice';

import type { OutlinePoint, SermonOutline, SubPoint } from '@/models/models';

const plan = (main: OutlinePoint[], conclusion: OutlinePoint[] = []): SermonOutline => ({ introduction: [], main, conclusion });
const point = (id: string, text: string, subPoints?: SubPoint[]): OutlinePoint => ({ id, text, ...(subPoints ? { subPoints } : {}) });
const sub = (id: string, text: string, position = 1): SubPoint => ({ id, text, position });
const homes = (outline: SermonOutline, id: string) => [outline.introduction,outline.main,outline.conclusion].flatMap(points => points.filter(p => p.subPoints?.some(s => s.id === id)).map(p => p.id));

describe('an explicit local outline choice keeps only the scope of local changes', () => {
  it('retains a remote edit to a point this side did not change', () => {
    const base = plan([point('a','Original')]);
    expect(chooseOutlineLocalChanges(base,base,plan([point('a','Remote')])).main[0].text).toBe('Remote');
  });

  it('chooses local colliding words without reverting another point', () => {
    const base = plan([point('a','A'),point('b','B')]);
    const chosen = chooseOutlineLocalChanges(base,plan([point('a','Local A'),point('b','B')]),plan([point('a','Remote A'),point('b','Remote B')]));
    expect(chosen.main.map(p => p.text)).toEqual(['Local A','Remote B']);
  });

  it('keeps remote sub-point words beside a local parent rewrite', () => {
    const base = plan([point('a','A',[sub('s','Original')])]);
    const chosen = chooseOutlineLocalChanges(base,plan([point('a','Local',[sub('s','Original')])]),plan([point('a','Remote',[sub('s','Remote sub')])]));
    expect(chosen.main[0]).toMatchObject({text:'Local',subPoints:[{id:'s',text:'Remote sub'}]});
  });

  it('chooses one home for a sub-point moved differently while keeping an unrelated remote note', () => {
    const original = sub('s','Moving');
    const base = plan([point('a','A',[original]),point('b','B',[]),point('c','C',[])]);
    const mine = plan([point('a','A',[]),point('b','B',[original]),point('c','C',[])]);
    const theirs = plan([point('a','A',[]),point('b','B',[]),{...point('c','C',[original]),note:'Remote note'}]);
    const chosen = chooseOutlineLocalChanges(base,mine,theirs);
    expect(homes(chosen,'s')).toEqual(['b']);
    expect(chosen.main.find(p => p.id === 'c')?.note).toBe('Remote note');
  });

  it('does not resurrect a locally deleted sub-point from its new remote parent', () => {
    const original = sub('s','Moving');
    const base = plan([point('a','A',[original]),point('b','B',[])]);
    const mine = plan([point('a','Local A',[]),point('b','B',[])]);
    const theirs = plan([point('a','Remote A',[]),{...point('b','B',[original]),note:'Remote note'}]);
    const chosen = chooseOutlineLocalChanges(base,mine,theirs);
    expect(homes(chosen,'s')).toEqual([]);
    expect(chosen.main.find(p => p.id === 'b')?.note).toBe('Remote note');
  });

  it('combines a local move with remote words at the earlier location', () => {
    const base = plan([point('a','A')]);
    const chosen = chooseOutlineLocalChanges(base,plan([], [point('a','A')]),plan([point('a','Remote A')]));
    expect(chosen.main).toEqual([]);
    expect(chosen.conclusion).toEqual([point('a','Remote A')]);
  });

  it('retains local ordering of a point moved away from a remote deletion', () => {
    const base = plan([point('a','A'),point('b','B'),point('c','C')]);
    const mine = plan([point('a','Local A')],[point('c','C'),point('b','B')]);
    const theirs = plan([point('a','Remote A'),point('c','C')]);
    expect(chooseOutlineLocalChanges(base,mine,theirs).conclusion.map(p => p.id)).toEqual(['c','b']);
  });

  it('keeps independent remote additions in their relative position', () => {
    const base = plan([point('a','A'),point('b','B')]);
    const mine = plan([point('a','Local A'),point('b','B')]);
    const theirs = plan([point('a','Remote A'),point('new','Added'),point('b','B')]);
    expect(chooseOutlineLocalChanges(base,mine,theirs).main.map(p => p.id)).toEqual(['a','new','b']);
  });

  it('reads sub-point order by position while retaining independent additions', () => {
    const base = plan([point('a','A',[sub('two','Two',2),sub('one','One',1)])]);
    const mine = plan([point('a','Local A',[sub('two','Two',2),sub('one','One',1)])]);
    const theirs = plan([point('a','Remote A',[sub('two','Two',2),sub('three','Added',3),sub('one','One',1)])]);
    expect(chooseOutlineLocalChanges(base,mine,theirs).main[0].subPoints?.map(s => s.id)).toEqual(['one','two','three']);
  });

  it('does not mutate any input when the values agree', () => {
    const original = plan([point('a','A',[sub('s','S')])]);
    const before = JSON.stringify(original);
    expect(chooseOutlineLocalChanges(original,original,original)).toEqual(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('keeps the chosen new plan when there is no remote copy', () => {
    const mine = plan([point('a','A')]);
    expect(chooseOutlineLocalChanges(null,mine,null)).toEqual(mine);
  });
});

it('chooses the stored reminder without discarding a separate plan edit made while the question was open', () => {
  const first = { ...point('a', 'First'), note: 'Original reminder' };
  const second = point('b', 'Second');
  const before = plan([first, second]);
  const mine = plan([{ ...first, note: 'Reminder from this device' }, { ...second, text: 'New second point' }]);
  const stored = plan([{ ...first, note: 'Reminder from the other device' }, second]);
  const choice = readOutlineTextChoice(before, mine, stored);
  expect(choice).toMatchObject({ mine: 'Reminder from this device', stored: 'Reminder from the other device' });
  expect(choice?.acceptStored().main).toEqual([stored.main[0], mine.main[1]]);
});

it('keeps exact saved positions when resolving a reminder inside the plan editor', () => {
  const opening = { ...sub('reminder', 'Point', 8), note: 'Opening reminder' };
  const sibling = sub('sibling', 'Neighbor', 4);
  const before = plan([point('holder', 'Holder', [sibling, opening])]);
  const mine = plan([point('holder', 'Holder', [sibling, { ...opening, note: 'Local note' }])]);
  const stored = plan([point('holder', 'Stored title', [sibling, { ...opening, note: 'Stored note' }])]);
  const choice = readOutlineTextChoice(before, mine, stored);
  expect(choice?.acceptStored()).toEqual(stored);
  expect(choice?.acceptLocal()).toEqual(plan([{ ...stored.main[0], subPoints: mine.main[0].subPoints }]));
});

it.each(['point', 'subpoint'])('shows both %s titles before applying either choice', target => {
  const nested = sub('child', 'Child opening', 8);
  const parent = { ...point('parent', 'Point opening', [nested]), note: 'Opening reminder' };
  const before = plan([parent]);
  const rename = (text: string) => target === 'point' ? { ...parent, text }
    : { ...parent, subPoints: [{ ...nested, text }] };
  const mine = plan([rename('My earlier title')]);
  const stored = plan([{ ...rename('Saved title'), note: 'Independent saved reminder' }]);
  const choice = readOutlineTextChoice(before, mine, stored);

  expect(choice).toMatchObject({ mine: 'My earlier title', stored: 'Saved title' });
  expect(choice?.acceptStored()).toEqual(stored);
  expect(choice?.acceptLocal()).toEqual(plan([{ ...rename('My earlier title'), note: 'Independent saved reminder' }]));
});

it('leaves competing moves to the structure comparison even with only one reported note conflict', () => {
  const moved = point('moved', 'Moved point');
  const reminder = { ...point('reminder', 'Separate point'), note: 'Opening reminder' };
  const before = plan([moved, reminder]);
  const mine = { ...plan([{ ...reminder, note: 'Local reminder' }]), introduction: [moved] };
  const stored = plan([{ ...reminder, note: 'Stored reminder' }], [moved]);

  expect(readOutlineTextChoice(before, mine, stored)).toBeUndefined();
});
