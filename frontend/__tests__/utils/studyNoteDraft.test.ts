import { isStudyNoteDraft } from '@/utils/studyNoteDraft';

const reference = { id: 'r', book: 'Isaiah', chapter: 40, fromVerse: 31 };

describe('isStudyNoteDraft — the one draft rule of the server and the device', () => {
  it('keeps a note a draft until it has a tag and a reference', () => {
    expect(isStudyNoteDraft({ type: 'note', tags: [], scriptureRefs: [reference] })).toBe(true);
    expect(isStudyNoteDraft({ type: 'note', tags: ['t'], scriptureRefs: [] })).toBe(true);
    expect(isStudyNoteDraft({ tags: ['t'], scriptureRefs: [reference] })).toBe(false);
    expect(isStudyNoteDraft({ type: 'question', tags: undefined, scriptureRefs: [reference] })).toBe(true);
  });

  it('never calls a passage analysis a draft — it is its own work and carries no tags', () => {
    expect(isStudyNoteDraft({ type: 'analysis', tags: [], scriptureRefs: [reference] })).toBe(false);
  });

  it('never calls a comment a draft — it carries no tags', () => {
    expect(isStudyNoteDraft({ type: 'comment', tags: [], scriptureRefs: [reference] })).toBe(false);
    expect(isStudyNoteDraft({ type: 'comment', tags: [], scriptureRefs: [] })).toBe(false);
  });
});
