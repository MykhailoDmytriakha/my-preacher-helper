import { litLinkKey, arriveAt, DEFAULT_TRAIL_LIMITS, EMPTY_TRAIL, keepWithin, linkBefore, readOn, sameChapter, type Trail, type TrailPlace } from '@/utils/placeTrail';

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

  it('a place is a chapter: another verse of a chapter among the recent ones is the same link, now at that verse', () => {
    const trail = walk([isaiah, at('Isaiah', 13, 1), isaiah, at('Isaiah', 13, 7)]);
    expect(names(trail)).toEqual(['Isaiah 19:1', 'Isaiah 13:7']);
    expect(trail.at).toBe(1);
  });

  it('the same chapter whichever Bible numbers it: Synodal Psalm 22 is King James Psalm 23', () => {
    expect(sameChapter(at('Psalms', 22, 1, 'rst'), at('Psalms', 23, 1, 'kjv'))).toBe(true);
    expect(sameChapter(at('Psalms', 22, 1, 'rst'), at('Psalms', 22, 1, 'kjv'))).toBe(false);
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

  it('reading on moves the link being read, into the next chapter too; the same verse changes nothing', () => {
    const trail = walk([isaiah, exodus]);
    const read = readOn(trail, exodus, at('Exodus', 13, 2), DEFAULT_TRAIL_LIMITS);
    expect(names(read)).toEqual(['Isaiah 19:1', 'Exodus 13:2']);
    expect(read.at).toBe(1);
    expect(readOn(read, at('Exodus', 13, 2), at('Exodus', 13, 2), DEFAULT_TRAIL_LIMITS)).toBe(read);
    expect(readOn(EMPTY_TRAIL, isaiah, at('Isaiah', 19, 2), DEFAULT_TRAIL_LIMITS)).toBe(EMPTY_TRAIL);
  });

  // The owner, 2026-10-20: "←" goes left along the trail, one link at a time.
  it('the way back is the link left of the reader\'s own one; the first link has none', () => {
    const trail = walk([at('Isaiah', 18, 7), at('Zephaniah', 3, 10), isaiah, at('Malachi', 2, 8)]);
    expect(names(trail)).toEqual(['Isaiah 18:7', 'Zephaniah 3:10', 'Isaiah 19:1', 'Malachi 2:8']);
    expect(linkBefore(trail, at('Malachi', 2, 8))).toBe(2);
    expect(linkBefore({ ...trail, at: 1 }, at('Zephaniah', 3, 10))).toBe(0);
    expect(linkBefore({ ...trail, at: 0 }, at('Isaiah', 18, 7))).toBe(-1);
    // Another tab lit a link meanwhile: the way back is still from this reader's place.
    expect(linkBefore({ ...trail, at: 3 }, at('Zephaniah', 3, 12))).toBe(0);
    expect(linkBefore(trail, at('Ruth', 1))).toBe(-1);
  });

  it('a place arriving where the light already is stays that link, however old: the way back adds nothing', () => {
    const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel'];
    const trail = walk(books.map((book) => at(book, 1)));
    const stepped = arriveAt({ ...trail, at: 0 }, at('Genesis', 1, 5), DEFAULT_TRAIL_LIMITS);
    expect(stepped.links).toHaveLength(9);
    expect(stepped.at).toBe(0);
    expect(names(stepped)[0]).toBe('Genesis 1:5');
  });

  // An independent review, 2026-10-20: Ruth 1 → Ruth 2 → back to Ruth 1, read on to 2:2 — the link of
  // Ruth 1 became a second link of Ruth 2, and a tap on the first lit the second.
  it('reading on into a chapter among the recent links lights that link; the one left keeps where the person stopped', () => {
    const trail = walk([at('Ruth', 1, 1), at('Ruth', 2, 1), at('Ruth', 1, 20)]);
    const read = readOn(trail, at('Ruth', 1, 20), at('Ruth', 2, 2), DEFAULT_TRAIL_LIMITS);
    expect(names(read)).toEqual(['Ruth 1:20', 'Ruth 2:2']);
    expect(read.at).toBe(1);
  });

  // The same review: the trail is shared by the tabs of a device; another tab lit its own place since.
  it('reading on moves the reader\'s own link, not the one another tab lit since', () => {
    const trail: Trail = { links: [isaiah, exodus], at: 1 };
    const read = readOn(trail, isaiah, at('Isaiah', 19, 2), DEFAULT_TRAIL_LIMITS);
    expect(names(read)).toEqual(['Isaiah 19:2', 'Exodus 12:12']);
    expect(read.at).toBe(0);
    expect(readOn(trail, at('Ruth', 1), at('Ruth', 2), DEFAULT_TRAIL_LIMITS)).toBe(trail);
  });
});

// Codex review, 2026-10-26: the column jumped back to the lit link while the person read on and scrolled it.
describe('where the light stands among the links', () => {
  it('stays while only the lit link moves — reading on within the chapter or into the next one: the column stays where it was scrolled', () => {
    const trail = walk([isaiah, exodus, joshua]);
    const within = readOn(trail, joshua, at('Joshua', 2, 15), DEFAULT_TRAIL_LIMITS);
    const next = readOn(within, at('Joshua', 2, 15), at('Joshua', 3, 1), DEFAULT_TRAIL_LIMITS);
    expect(names(next)).toEqual(['Isaiah 19:1', 'Exodus 12:12', 'Joshua 3:1']);
    expect(litLinkKey(within)).toBe(litLinkKey(trail));
    expect(litLinkKey(next)).toBe(litLinkKey(trail));
  });

  it('changes when the light goes to another link or the links shift: a recent place lit, a place added, a place added to the full trail, reading into a chapter on the trail', () => {
    const trail = walk([isaiah, exodus, joshua]);
    expect(litLinkKey(arriveAt(trail, exodus, DEFAULT_TRAIL_LIMITS))).not.toBe(litLinkKey(trail));
    expect(litLinkKey(arriveAt(trail, at('Ruth', 1), DEFAULT_TRAIL_LIMITS))).not.toBe(litLinkKey(trail));
    const full = walk([isaiah, exodus, joshua], { history: 3, recent: 2 });
    const moved = arriveAt(full, at('Ruth', 1), { history: 3, recent: 2 });
    expect(moved.links).toHaveLength(3);
    expect(moved.at).toBe(full.at);
    expect(litLinkKey(moved)).not.toBe(litLinkKey(full));
    // Reading on into a chapter that is a recent link lights that link: the light moved, so it is shown.
    const intoRecent = readOn(walk([at('Ruth', 1), at('Ruth', 2), at('Ruth', 1)]), at('Ruth', 1, 22), at('Ruth', 2, 1), DEFAULT_TRAIL_LIMITS);
    expect(intoRecent.at).toBe(1);
    expect(litLinkKey(intoRecent)).not.toBe(litLinkKey(walk([at('Ruth', 1), at('Ruth', 2), at('Ruth', 1)])));
  });
});
