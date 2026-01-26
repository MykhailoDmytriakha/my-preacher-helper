import { matchesSermonQuery, tokenizeQuery } from '../../app/utils/sermonSearch';
import { Sermon } from '../../app/models/models';

describe('sermonSearch structural tags', () => {
    const mockSermon: Sermon = {
        id: 'sermon1',
        title: 'Title',
        verse: 'Verse',
        date: '2023-01-01',
        userId: 'user1',
        thoughts: [
            {
                id: 't1',
                text: 'Thought 1',
                tags: ['intro'], // canonical id
                date: '2023-01-01T10:00:00Z'
            }
        ]
    };

    const mockT = (key: string) => {
        const translations: Record<string, string> = {
            'tags.introduction': 'Вступление',
            'tags.mainPart': 'Основная часть',
            'tags.conclusion': 'Заключение'
        };
        return translations[key] || key;
    };

    it('matches by canonical tag ID', () => {
        const tokens = tokenizeQuery('intro');
        expect(matchesSermonQuery(mockSermon, tokens)).toBe(true);
    });

    it('matches by localized name when "t" function is provided', () => {
        const tokens = tokenizeQuery('вступление');
        expect(matchesSermonQuery(mockSermon, tokens, undefined, mockT)).toBe(true);
    });

    it('does not match by localized name when "t" function is missing', () => {
        const tokens = tokenizeQuery('вступление');
        expect(matchesSermonQuery(mockSermon, tokens)).toBe(false);
    });

    it('matches case-insensitively for localized names', () => {
        const tokens = tokenizeQuery('ВСТУПЛЕНИЕ');
        expect(matchesSermonQuery(mockSermon, tokens, undefined, mockT)).toBe(true);
    });
});
