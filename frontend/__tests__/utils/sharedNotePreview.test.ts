import { buildSharedNotePreview, cardSafeText } from '@/utils/sharedNotePreview';

const words = { note: 'Note', question: 'Question', untitled: 'Untitled note' };
const luke = { id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 };
const john = { id: 'r2', book: 'John', chapter: 3, fromVerse: 16 };
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('buildSharedNotePreview', () => {
  it('names the note by its own title and teases with the start of its text', () => {
    const preview = buildSharedNotePreview(
      { title: 'Faith that carries', content: 'Four men **carried** their friend.\n\nThe roof was no obstacle.', scriptureRefs: [luke], type: 'note' },
      'en',
      words
    );
    expect(preview.title).toBe('Faith that carries');
    expect(preview.description).toBe('Four men carried their friend. The roof was no obstacle.');
    expect(preview.passages).toBe('Luke 5:17-26');
    expect(preview.kind).toBe('Note');
  });

  it('falls back to the first passage when the note has no title, and lists the rest under it', () => {
    const preview = buildSharedNotePreview({ content: 'Text', scriptureRefs: [luke, john], type: 'note' }, 'en', words);
    expect(preview.title).toBe('Luke 5:17-26');
    expect(preview.passages).toBe('John 3:16');
  });

  it('takes the first line as the title when there is neither title nor passage, and does not repeat it', () => {
    const preview = buildSharedNotePreview(
      { content: '# Grace before law\n\nGrace came first.', scriptureRefs: [], type: 'note' },
      'en',
      words
    );
    expect(preview.title).toBe('Grace before law');
    expect(preview.description).toBe('Grace came first.');
  });

  it('takes the first LINE, not the first paragraph, when lines are not separated by a blank one', () => {
    const preview = buildSharedNotePreview(
      { content: 'First line\nSecond line with the note', scriptureRefs: [], type: 'note' },
      'en',
      words
    );
    expect(preview.title).toBe('First line');
    expect(preview.description).toBe('Second line with the note');
  });

  it('reads a heading glued to its text as two paragraphs and puts a full stop between them', () => {
    const preview = buildSharedNotePreview(
      { title: 'T', content: '# Nine chapters of names\nReading them is hard\n\nNo speeches, no events.', scriptureRefs: [], type: 'note' },
      'en',
      words
    );
    expect(preview.description).toBe('Nine chapters of names. Reading them is hard. No speeches, no events.');
  });

  it('says "untitled" only when the note is empty', () => {
    const preview = buildSharedNotePreview({ content: '   ', scriptureRefs: [], type: 'question' }, 'en', words);
    expect(preview.title).toBe('Untitled note');
    expect(preview.description).toBeUndefined();
    expect(preview.kind).toBe('Question');
  });

  it('treats a note made only of Markdown syntax or code as empty', () => {
    expect(buildSharedNotePreview({ content: '#\n***\n---', scriptureRefs: [], type: 'note' }, 'en', words).title).toBe('Untitled note');
    expect(buildSharedNotePreview({ content: '```js\nconst secret = 1;', scriptureRefs: [], type: 'note' }, 'en', words).title).toBe('Untitled note');
    expect(buildSharedNotePreview({ content: '```\nonly code\n```', scriptureRefs: [], type: 'note' }, 'en', words).title).toBe('Untitled note');
  });

  it('strips markdown syntax a messenger would print literally', () => {
    const preview = buildSharedNotePreview(
      { title: 'T', content: '> Quote\n- item one\n1. [link text](https://example.com) and `code`\n\n![img](x.png)', scriptureRefs: [], type: 'note' },
      'en',
      words
    );
    expect(preview.description).toBe('Quote item one link text and code');
  });

  it('removes real tags but keeps comparisons written with angle brackets', () => {
    const preview = buildSharedNotePreview(
      { title: 'T', content: 'Faith: 5 < 7 > 3 and <b>bold</b> words', scriptureRefs: [], type: 'note' },
      'en',
      words
    );
    expect(preview.description).toBe('Faith: 5 < 7 > 3 and bold words');
  });

  it('cuts a long text on a word boundary with an ellipsis', () => {
    const content = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const preview = buildSharedNotePreview({ title: 'T', content, scriptureRefs: [], type: 'note' }, 'en', words);
    expect(preview.description!.length).toBeLessThanOrEqual(201);
    expect(preview.description!.endsWith('…')).toBe(true);
    const kept = preview.description!.slice(0, -1);
    expect(content.startsWith(kept)).toBe(true);
    expect(content.split(' ')).toContain(kept.split(' ').pop());
  });

  it('never cuts through an emoji or a long word into half a character', () => {
    const content = `A ${'🙏'.repeat(300)}`;
    const preview = buildSharedNotePreview({ title: '👨‍👩‍👧'.repeat(120), content, scriptureRefs: [], type: 'note' }, 'en', words);
    expect(preview.description!.endsWith('…')).toBe(true);
    expect(LONE_SURROGATE.test(preview.description!)).toBe(false);
    expect(LONE_SURROGATE.test(preview.title)).toBe(false);
    expect(Array.from(preview.description!).length).toBeLessThan(300);
  });

  it('writes passages in the author language', () => {
    const preview = buildSharedNotePreview({ title: 'T', content: 'x', scriptureRefs: [luke], type: 'note' }, 'ru', words);
    expect(preview.passages).toBe('От Луки 5:17-26');
  });
});

describe('cardSafeText', () => {
  it('keeps Latin, Cyrillic, digits and punctuation and drops emoji and other scripts', () => {
    expect(cardSafeText('Вера 🙏 and שלום — hope! (Luke 5:17)')).toBe('Вера and — hope! (Luke 5:17)');
    expect(cardSafeText('👨‍👩‍👧 family')).toBe('family');
  });
});
