import { inStudies, inStudyNoteTab, STUDY_NOTE_TABS } from '@/utils/studyNoteTabs';

describe('inStudyNoteTab — which tab of Studies a note stands in', () => {
  it('keeps notes, comments and questions apart, and all of them in «Все»', () => {
    const where = (type?: 'note' | 'question' | 'comment') => STUDY_NOTE_TABS.filter((tab) => inStudyNoteTab({ type }, tab));
    expect(where(undefined)).toEqual(['all', 'notes']);
    expect(where('note')).toEqual(['all', 'notes']);
    expect(where('comment')).toEqual(['all', 'comments']);
    expect(where('question')).toEqual(['all', 'questions']);
  });

  it('shows a passage analysis in no tab yet — it opens in the Bible, not in the note editor', () => {
    expect(STUDY_NOTE_TABS.filter((tab) => inStudyNoteTab({ type: 'analysis' }, tab))).toEqual([]);
  });
});

describe('inStudies — what Studies and the home page count', () => {
  it('counts what the tabs show: notes, comments and questions, not a passage analysis', () => {
    // Codex, 30.10: «Все» said 3 over one card when two analyses stood beside one note.
    const notes = [{ type: 'note' as const }, { type: 'analysis' as const }, { type: 'analysis' as const }];
    expect(notes.filter(inStudies)).toHaveLength(notes.filter((note) => inStudyNoteTab(note, 'all')).length);
    expect(notes.filter(inStudies)).toEqual([{ type: 'note' }]);
    expect([undefined, 'question', 'comment'].every((type) => inStudies({ type: type as 'question' }))).toBe(true);
  });
});
