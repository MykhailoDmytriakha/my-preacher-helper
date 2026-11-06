import { inStudyNoteTab, STUDY_NOTE_TABS } from '@/utils/studyNoteTabs';

describe('inStudyNoteTab — which tab of Studies a note stands in', () => {
  const where = (type?: 'note' | 'question' | 'comment' | 'analysis') => STUDY_NOTE_TABS.filter((tab) => inStudyNoteTab({ type }, tab));

  it('keeps notes, comments and questions apart, and all of them in «Все»', () => {
    expect(where(undefined)).toEqual(['all', 'notes']);
    expect(where('note')).toEqual(['all', 'notes']);
    expect(where('comment')).toEqual(['all', 'comments']);
    expect(where('question')).toEqual(['all', 'questions']);
  });

  it('gives a passage analysis its own tab «Разборы», and «Все» — never «Заметки»', () => {
    // The owner, 02.11: «Изучение, вкладка „Разборы“».
    expect(where('analysis')).toEqual(['all', 'analyses']);
  });

  it('counts in «Все» exactly what the other tabs show between them', () => {
    // Codex, 30.10: «Все» once said 3 over one card while two analyses stood beside one note.
    const notes = [{ type: 'note' as const }, { type: 'analysis' as const }, { type: 'comment' as const }, { type: 'question' as const }, {}];
    const inOwnTabs = STUDY_NOTE_TABS.filter((tab) => tab !== 'all')
      .reduce((sum, tab) => sum + notes.filter((note) => inStudyNoteTab(note, tab)).length, 0);
    expect(notes.filter((note) => inStudyNoteTab(note, 'all'))).toHaveLength(inOwnTabs);
  });
});
