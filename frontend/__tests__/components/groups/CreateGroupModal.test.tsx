import { createGroupDraft } from '@/components/groups/CreateGroupModal';

/**
 * THE NEW GROUP THE CREATE DIALOG HANDS TO THE ENGINE (EngineCreateGroupModal). Its words are
 * trimmed, it starts with the three standard blocks in order, and a first meeting date is kept.
 */

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as never;

describe('createGroupDraft', () => {
  it('trims the words and starts with three blocks and the first meeting date', () => {
    const draft = createGroupDraft('user-1', '  Group A  ', '  Notes  ', '2026-02-14', t);

    expect(draft.userId).toBe('user-1');
    expect(draft.title).toBe('Group A');
    expect(draft.description).toBe('Notes');
    expect(draft.templates.map(template => template.type)).toEqual(['prayer', 'topic', 'scripture']);
    expect(draft.flow.map(item => item.templateId)).toEqual(draft.templates.map(template => template.id));
    expect(draft.meetingDates).toHaveLength(1);
    expect(draft.meetingDates?.[0]?.date).toBe('2026-02-14');
  });

  it('keeps no meeting date when none was given', () => {
    expect(createGroupDraft('user-1', 'Group', '', '', t).meetingDates).toEqual([]);
  });
});
