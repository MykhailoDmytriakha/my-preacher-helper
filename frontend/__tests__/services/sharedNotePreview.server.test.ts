/** @jest-environment node */
import { readSharedNotePreview } from '@/services/sharedNotePreview.server';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

jest.mock('@repositories/studyNoteShareLinks.repository', () => ({
  studyNoteShareLinksRepository: { readSharedNote: jest.fn(), incrementViewCount: jest.fn() },
}));

const repository = studyNoteShareLinksRepository as jest.Mocked<typeof studyNoteShareLinksRepository>;
const shareLink = { id: 'link', noteId: 'note', ownerId: 'owner', token: 'token', createdAt: '2026-09-26T00:00:00.000Z', viewCount: 0 };
const luke = { id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 };

describe('readSharedNotePreview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns nothing for a token that opens no note', async () => {
    repository.readSharedNote.mockResolvedValue(null);
    expect(await readSharedNotePreview('token')).toBeNull();
  });

  it('speaks the language the note is written in, words and passages alike', async () => {
    repository.readSharedNote.mockResolvedValue({ shareLink, content: 'Четверо друзей несли расслабленного.', scriptureRefs: [luke], type: 'question' });
    const preview = await readSharedNotePreview('token');
    expect(preview).toMatchObject({
      locale: 'ru',
      kind: ru.studiesWorkspace.type.question,
      title: 'От Луки 5:17-26',
      description: 'Четверо друзей несли расслабленного.',
    });
  });

  it('tells Ukrainian from Russian by its own letters', async () => {
    repository.readSharedNote.mockResolvedValue({ shareLink, content: 'Віра, що несе друзів.', scriptureRefs: [], type: 'note' });
    expect(await readSharedNotePreview('token')).toMatchObject({ locale: 'uk', kind: uk.studiesWorkspace.type.note, title: 'Віра, що несе друзів.' });
  });

  it('never counts a preview fetch as a view', async () => {
    repository.readSharedNote.mockResolvedValue({ shareLink, content: 'Text', scriptureRefs: [], type: 'note' });
    await readSharedNotePreview('token');
    expect(repository.incrementViewCount).not.toHaveBeenCalled();
  });

  it('gives a failed read one more try before giving up', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    repository.readSharedNote
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ shareLink, content: 'Text', scriptureRefs: [], type: 'note' });
    expect(await readSharedNotePreview('token')).toMatchObject({ title: 'Text' });
    expect(repository.readSharedNote).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it('swallows a read that fails twice into "no preview" instead of breaking the page', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    repository.readSharedNote.mockRejectedValue(new Error('boom'));
    expect(await readSharedNotePreview('token')).toBeNull();
    expect(repository.readSharedNote).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
