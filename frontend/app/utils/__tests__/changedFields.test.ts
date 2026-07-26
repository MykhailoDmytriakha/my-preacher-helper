import { changedFields } from '@/utils/changedFields';

describe('changedFields', () => {
  it('returns nothing when the user changed nothing', () => {
    const base = { title: 'A', body: 'B' };
    expect(changedFields(base, { title: 'A', body: 'B' })).toEqual({});
  });

  it('returns only the touched field', () => {
    const base = { title: 'A', body: 'B' };
    expect(changedFields(base, { title: 'A', body: 'B edited' })).toEqual({ body: 'B edited' });
  });

  it('compares arrays and objects by value, not identity', () => {
    const base = { tags: ['x'], refs: [{ book: 'John' }] };
    const next = { tags: ['x'], refs: [{ book: 'John' }] };

    expect(changedFields(base, next)).toEqual({});
  });

  it('detects a real change inside an array', () => {
    const base = { tags: ['x'] };
    expect(changedFields(base, { tags: ['x', 'y'] })).toEqual({ tags: ['x', 'y'] });
  });

  it('THE POINT: an untouched field stays out even when the server moved on', () => {
    // Reproduced live before this existed. Tab A renames the note; tab B, opened
    // earlier, still shows the OLD name in its input. If the diff were taken
    // against the refreshed cache ("A's new name"), B's untouched title would read
    // as a deliberate rename back and destroy A's edit. Against the value B
    // OPENED WITH, the title is simply untouched.
    const whatTabBOpenedWith = { title: 'original', body: 'original body' };
    const whatTabBShowsNow = { title: 'original', body: 'original body + B typed here' };

    const sent = changedFields(whatTabBOpenedWith, whatTabBShowsNow);

    expect(sent).toEqual({ body: 'original body + B typed here' });
    expect('title' in sent).toBe(false);
  });

  it('keeps re-sending a genuinely changed field until a save advances the baseline', () => {
    const base = { title: 'original' };
    const edited = { title: 'edited' };

    // First attempt fails: the baseline is unchanged, so the next pass sends it again.
    expect(changedFields(base, edited)).toEqual({ title: 'edited' });
    expect(changedFields(base, edited)).toEqual({ title: 'edited' });

    // Once a save confirms it, the baseline advances and it stops being sent.
    expect(changedFields(edited, edited)).toEqual({});
  });

  it('sends everything when there is no baseline yet', () => {
    expect(changedFields(null, { title: 'A', body: 'B' })).toEqual({ title: 'A', body: 'B' });
  });

  it('stops sending a field the user edited and then undid by hand', () => {
    const base = { title: 'original' };
    expect(changedFields(base, { title: 'typo' })).toEqual({ title: 'typo' });
    expect(changedFields(base, { title: 'original' })).toEqual({});
  });
});
