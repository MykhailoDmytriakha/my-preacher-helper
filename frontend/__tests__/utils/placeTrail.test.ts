import { actedVerses, arriveAt, DEFAULT_TRAIL_LIMITS, EMPTY_TRAIL, keepWithin, leaveAt, linkBefore, linkOnScreen, litLinkKey, sameVerse, type Trail, type TrailPlace } from '@/utils/placeTrail';

const at = (book: string, chapter: number, verse = 1, bible: TrailPlace['bible'] = 'rst'): TrailPlace => ({ book, chapter, verse, bible });
const walk = (places: TrailPlace[], limits = DEFAULT_TRAIL_LIMITS, from: Trail = EMPTY_TRAIL) =>
  places.reduce((trail, place) => arriveAt(trail, place, limits), from);
const names = (trail: Trail) => trail.links.map((link) => `${link.book} ${link.chapter}:${link.verse}`);

const isaiah = at('Isaiah', 19, 1);
const exodus = at('Exodus', 12, 12);
const joshua = at('Joshua', 2, 11);

describe('the trail of places', () => {
  // The owner, 2026-10-20: "I study place 1, go to 2, come back to 1, go to 3, come back, and want 2 again".
  it('the owner\'s scenario: three links, the light on the place gone back to, nothing added by coming back', () => {
    const trail = walk([isaiah, exodus, isaiah, joshua, isaiah, exodus]);
    expect(names(trail)).toEqual(['Isaiah 19:1', 'Exodus 12:12', 'Joshua 2:11']);
    expect(trail.at).toBe(1);
  });

  it('going back and forth, or round a circle of five places, never grows the trail', () => {
    const circle = [at('Genesis', 1), at('Genesis', 22), at('Romans', 4), at('Hebrews', 11), at('James', 2)];
    const trail = walk([...circle, ...circle, ...circle, circle[1], circle[0], circle[1]]);
    expect(trail.links).toHaveLength(5);
    expect(trail.at).toBe(1);
  });

  it('a place seen longer ago than the recent ones joins the end again; its old link stays', () => {
    const links = [at('Jeremiah', 46), at('Ezekiel', 29), at('Psalms', 17, 11), at('Isaiah', 13), at('Revelation', 1, 7)];
    // Isaiah 19:1 studied link after link, coming back to it after each.
    const trail = walk([isaiah, exodus, isaiah, joshua, ...links.flatMap((link) => [isaiah, link]), isaiah]);
    expect(trail.links[0].book).toBe('Isaiah');
    expect(names(trail).slice(-2)).toEqual(['Revelation 1:7', 'Isaiah 19:1']);
    expect(trail.at).toBe(trail.links.length - 1);
    expect(trail.links).toHaveLength(9);
  });

  // The owner, 2026-10-27: every act on a verse is a point of its own — a mark, a copy, its links.
  it('a place is a verse: verses of one chapter are links of their own; the same verse again is that link', () => {
    const trail = walk([at('Romans', 8, 28), at('Romans', 8, 30), at('Romans', 8, 31), at('Romans', 8, 28)]);
    expect(names(trail)).toEqual(['Romans 8:28', 'Romans 8:30', 'Romans 8:31']);
    expect(trail.at).toBe(0);
  });

  it('the same verse whichever Bible numbers it: Synodal Psalm 22:1 is King James Psalm 23:1', () => {
    expect(sameVerse(at('Psalms', 22, 1, 'rst'), at('Psalms', 23, 1, 'kjv'))).toBe(true);
    expect(sameVerse(at('Psalms', 22, 1, 'rst'), at('Psalms', 22, 1, 'kjv'))).toBe(false);
    expect(sameVerse(at('Psalms', 22, 2, 'rst'), at('Psalms', 23, 1, 'kjv'))).toBe(false);
    const trail = walk([at('Psalms', 22, 1, 'rst'), at('John', 3, 16, 'kjv'), at('Psalms', 23, 1, 'kjv')]);
    expect(trail.links).toHaveLength(2);
    expect(trail.at).toBe(0);
  });

  it('keeps no more than the history: the oldest links leave first', () => {
    const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings'];
    const trail = walk(books.map((book) => at(book, 1)), { history: 10, recent: 7 });
    expect(trail.links.map((link) => link.book)).toEqual(books.slice(2));
    expect(trail.at).toBe(9);
  });

  it('a shorter history never takes the link being read', () => {
    const trail: Trail = { links: [isaiah, exodus, joshua, at('Ruth', 1), at('Job', 1)], at: 0 };
    const kept = keepWithin(trail, 3);
    expect(kept.links[kept.at]).toEqual(isaiah);
    expect(names(kept)).toEqual(['Isaiah 19:1', 'Ruth 1:1', 'Job 1:1']);
  });

  // Codex review, 2026-10-27: where one Bible joins two verses, the match held one way only.
  it('a verse joined in one Bible is the same place either way round', () => {
    const joined = at('Acts', 19, 40, 'rst');
    const kingJames = [at('Acts', 19, 40, 'kjv'), at('Acts', 19, 41, 'kjv')];
    for (const verse of kingJames) {
      expect(sameVerse(joined, verse)).toBe(true);
      expect(sameVerse(verse, joined)).toBe(true);
    }
    expect(walk([kingJames[1], at('John', 3, 16, 'kjv'), joined]).links).toHaveLength(2);
  });

  // Codex review r2, 2026-10-27: the light went out while the second of two joined verses was read.
  it('a link is on the screen while any verse it covers in the Bible read is', () => {
    const link = at('Acts', 19, 40, 'rst');
    const seen = (from: number, to: number) => ({ first: { chapter: 19, verse: from }, last: { chapter: 20, verse: to } });
    expect(linkOnScreen(link, 'Acts', seen(41, 5), 'kjv')).toBe(true);
    expect(linkOnScreen(link, 'Acts', { first: { chapter: 20, verse: 1 }, last: { chapter: 20, verse: 9 } }, 'kjv')).toBe(false);
    expect(linkOnScreen(link, 'Romans', seen(1, 5), 'kjv')).toBe(false);
    expect(linkOnScreen(link, 'Acts', null, 'kjv')).toBe(false);
  });

  it('a passage across a chapter\'s end is one run where the chapter\'s length is known', () => {
    const passage = [{ chapter: 1, verse: 22 }, { chapter: 2, verse: 1 }];
    expect(actedVerses(passage, (chapter) => ({ 1: 22, 2: 23 } as Record<number, number>)[chapter])).toEqual([{ chapter: 1, verse: 22 }]);
    expect(actedVerses(passage)).toEqual(passage);
  });

  // The owner, 2026-10-27: «если вышли, то он уже попадёт в историю, как тот, где ты остановился».
  it('leaving, the verse the person stopped at joins the end and the light stays; one already there, or the lit one, adds nothing', () => {
    const trail = walk([isaiah, exodus]);
    const left = leaveAt(trail, at('Exodus', 13, 4), DEFAULT_TRAIL_LIMITS);
    expect(names(left)).toEqual(['Isaiah 19:1', 'Exodus 12:12', 'Exodus 13:4']);
    expect(left.at).toBe(1);
    expect(leaveAt(trail, exodus, DEFAULT_TRAIL_LIMITS)).toBe(trail);
    expect(leaveAt(left, at('Exodus', 13, 4), DEFAULT_TRAIL_LIMITS)).toBe(left);
    expect(leaveAt(EMPTY_TRAIL, isaiah, DEFAULT_TRAIL_LIMITS)).toEqual({ links: [isaiah], at: 0 });
  });

  // The owner, 2026-10-27: 9:10 chosen, then 7:10–12, then 8:13 → 9:10, 7:10, 8:13.
  it('an act on several verses leaves one verse a run — its first — in the order the runs were chosen', () => {
    const chosen = [{ chapter: 9, verse: 10 }, { chapter: 7, verse: 11 }, { chapter: 7, verse: 10 }, { chapter: 7, verse: 12 }, { chapter: 8, verse: 13 }, { chapter: 7, verse: 11 }];
    expect(actedVerses(chosen)).toEqual([{ chapter: 9, verse: 10 }, { chapter: 7, verse: 10 }, { chapter: 8, verse: 13 }]);
    expect(actedVerses([{ chapter: 1, verse: 1 }])).toEqual([{ chapter: 1, verse: 1 }]);
    expect(actedVerses([])).toEqual([]);
  });

  // The owner, 2026-10-20: "←" goes left along the trail, one link at a time.
  it('the way back is the link left of the reader\'s own one; the first link has none', () => {
    const trail = walk([at('Isaiah', 18, 7), at('Zephaniah', 3, 10), isaiah, at('Malachi', 2, 8)]);
    expect(names(trail)).toEqual(['Isaiah 18:7', 'Zephaniah 3:10', 'Isaiah 19:1', 'Malachi 2:8']);
    expect(linkBefore(trail, at('Malachi', 2, 8))).toBe(2);
    expect(linkBefore({ ...trail, at: 1 }, at('Zephaniah', 3, 10))).toBe(0);
    expect(linkBefore({ ...trail, at: 0 }, at('Isaiah', 18, 7))).toBe(-1);
    // Another tab lit a link meanwhile: the way back is still from the verse this reader put on the trail.
    expect(linkBefore({ ...trail, at: 3 }, at('Zephaniah', 3, 10))).toBe(0);
    expect(linkBefore(trail, at('Ruth', 1))).toBe(-1);
  });

  it('a verse arriving where the light already is stays that link, however old: the way back adds nothing', () => {
    const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel'];
    const trail = walk(books.map((book) => at(book, 1)));
    const stepped = arriveAt({ ...trail, at: 0 }, at('Genesis', 1, 1), DEFAULT_TRAIL_LIMITS);
    expect(stepped.links).toHaveLength(9);
    expect(stepped.at).toBe(0);
  });
});

// Codex review, 2026-10-26: the column jumped back to the lit link while the person read on and scrolled it.
describe('where the light stands among the links', () => {
  it('stays while nothing moves: the same verse arriving again keeps the column where it was scrolled', () => {
    const trail = walk([isaiah, exodus, joshua]);
    expect(litLinkKey(arriveAt(trail, joshua, DEFAULT_TRAIL_LIMITS))).toBe(litLinkKey(trail));
  });

  it('changes when the light goes to another link or the links shift: a recent verse lit, a verse added, a verse added to the full trail, a stop left', () => {
    const trail = walk([isaiah, exodus, joshua]);
    expect(litLinkKey(arriveAt(trail, exodus, DEFAULT_TRAIL_LIMITS))).not.toBe(litLinkKey(trail));
    expect(litLinkKey(arriveAt(trail, at('Ruth', 1), DEFAULT_TRAIL_LIMITS))).not.toBe(litLinkKey(trail));
    const full = walk([isaiah, exodus, joshua], { history: 3, recent: 2 });
    const moved = arriveAt(full, at('Ruth', 1), { history: 3, recent: 2 });
    expect(moved.links).toHaveLength(3);
    expect(moved.at).toBe(full.at);
    expect(litLinkKey(moved)).not.toBe(litLinkKey(full));
    expect(litLinkKey(leaveAt(trail, at('Joshua', 2, 20), DEFAULT_TRAIL_LIMITS))).not.toBe(litLinkKey(trail));
  });
});
