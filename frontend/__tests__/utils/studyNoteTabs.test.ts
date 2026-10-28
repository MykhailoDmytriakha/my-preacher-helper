import { inStudyNoteTab, STUDY_NOTE_TABS } from '@/utils/studyNoteTabs';

describe('inStudyNoteTab — which tab of Studies a note stands in', () => {
  it('keeps notes, comments and questions apart, and all of them in «Все»', () => {
    const where = (type?: 'note' | 'question' | 'comment') => STUDY_NOTE_TABS.filter((tab) => inStudyNoteTab({ type }, tab));
    expect(where(undefined)).toEqual(['all', 'notes']);
    expect(where('note')).toEqual(['all', 'notes']);
    expect(where('comment')).toEqual(['all', 'comments']);
    expect(where('question')).toEqual(['all', 'questions']);
  });
});
