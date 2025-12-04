import { BIBLE_BOOKS } from '@/constants/bible';
import { ScriptureReference } from '@/models/models';

type BookMatch = { book: string; remaining: string[] };

const ORDERED_BOOKS: Array<{ english: string; aliases: string[] }> = [
  { english: 'Genesis', aliases: ['бытие', 'книга бытие', 'быт'] },
  { english: 'Exodus', aliases: ['исход', 'книга исход', 'исх', 'исхода'] },
  { english: 'Leviticus', aliases: ['левит', 'книга левит', 'лев'] },
  { english: 'Numbers', aliases: ['числа', 'книга числа', 'чис'] },
  { english: 'Deuteronomy', aliases: ['второзаконие', 'книга второзакония', 'втор', 'второзак'] },
  { english: 'Joshua', aliases: ['иисус навин', 'книга иисуса навина', 'навин'] },
  { english: 'Judges', aliases: ['судьи', 'книга судей', 'судья', 'суд'] },
  { english: 'Ruth', aliases: ['руфь', 'книга руфь', 'руф'] },
  {
    english: '1 Samuel',
    aliases: ['1 царств', '1-я книга царств', 'первая книга царств', '1 сам', '1сам', '1 цар', '1 царств', '1цар'],
  },
  {
    english: '2 Samuel',
    aliases: ['2 царств', '2-я книга царств', 'вторая книга царств', '2 сам', '2сам', '2 цар', '2 царств', '2цар'],
  },
  {
    english: '1 Kings',
    aliases: ['3 царств', '3-я книга царств', 'третья книга царств', '3 цар', '3 царств', '3цар'],
  },
  {
    english: '2 Kings',
    aliases: ['4 царств', '4-я книга царств', 'четвертая книга царств', '4 цар', '4 царств', '4цар'],
  },
  {
    english: '1 Chronicles',
    aliases: ['1 паралипоменон', '1-я книга паралипоменон', 'первая книга паралипоменон', '1 пар', '1пар'],
  },
  {
    english: '2 Chronicles',
    aliases: ['2 паралипоменон', '2-я книга паралипоменон', 'вторая книга паралипоменон', '2 пар', '2пар'],
  },
  { english: 'Ezra', aliases: ['ездра', 'книга ездра', 'ез', 'езд'] },
  { english: 'Nehemiah', aliases: ['неемия', 'книга неемии', 'неем'] },
  { english: 'Esther', aliases: ['есфирь', 'книга есфири', 'эстирь', 'есф'] },
  { english: 'Job', aliases: ['иов', 'книга иова'] },
  { english: 'Psalms', aliases: ['псалтирь', 'пс', 'псал'] },
  { english: 'Proverbs', aliases: ['притчи', 'поу́чения', 'притч', 'притчи соломоновы', 'прит'] },
  { english: 'Ecclesiastes', aliases: ['екклесиаст', 'проповедник', 'екк', 'ек'] },
  { english: 'Song of Solomon', aliases: ['песнь песней', 'песнь-песней', 'песн', 'песнь'] },
  { english: 'Isaiah', aliases: ['исаия', 'книга исаии', 'ис'] },
  { english: 'Jeremiah', aliases: ['иеремия', 'книга иеремии', 'иер'] },
  { english: 'Lamentations', aliases: ['плач иеремии', 'плач'] },
  { english: 'Ezekiel', aliases: ['иезекииль', 'книга иезекииля', 'иезекий', 'иез'] },
  { english: 'Daniel', aliases: ['даниил', 'книга даниила', 'дан'] },
  { english: 'Hosea', aliases: ['осия', 'книга осии', 'ос'] },
  { english: 'Joel', aliases: ['иоиль', 'книга иоиля', 'иоил'] },
  { english: 'Amos', aliases: ['амос', 'книга амоса', 'ам'] },
  { english: 'Obadiah', aliases: ['авдий', 'обадия', 'авд'] },
  { english: 'Jonah', aliases: ['иона', 'книга ионы', 'ион'] },
  { english: 'Micah', aliases: ['михей', 'книга михея', 'мик'] },
  { english: 'Nahum', aliases: ['наум', 'книга наума', 'нам'] },
  { english: 'Habakkuk', aliases: ['аввакум', 'книга аввакума', 'авв'] },
  { english: 'Zephaniah', aliases: ['софония', 'книга софонии', 'соф'] },
  { english: 'Haggai', aliases: ['аггей', 'книга аггея', 'агг'] },
  { english: 'Zechariah', aliases: ['захария', 'книга захарии', 'зах'] },
  { english: 'Malachi', aliases: ['малахия', 'книга малахии', 'мал'] },
  {
    english: 'Matthew',
    aliases: ['матфей', 'евангелие от матфея', 'евангелие матфея', 'матф', 'мат', 'матфея'],
  },
  {
    english: 'Mark',
    aliases: ['марк', 'евангелие от марка', 'евангелие марка', 'марк', 'мар', 'мк', 'марка' ],
  },
  {
    english: 'Luke',
    aliases: ['лука', 'евангелие от луки', 'евангелие луки', 'лк', 'лук', 'луки'],
  },
  {
    english: 'John',
    aliases: ['иоанн', 'евангелие от иоанна', 'евангелие иоанна', 'иоанн', 'иоан', 'ин'],
  },
  { english: 'Acts', aliases: ['деяния', 'деяния апостолов', 'деяния', 'дея', 'деян'] },
  { english: 'Romans', aliases: ['римлянам', 'послание к римлянам', 'рим'] },
  {
    english: '1 Corinthians',
    aliases: ['1 коринфянам', '1-е послание к коринфянам', 'первое послание к коринфянам', '1 кор', '1кор'],
  },
  {
    english: '2 Corinthians',
    aliases: ['2 коринфянам', '2-е послание к коринфянам', '2 кор', '2кор'],
  },
  { english: 'Galatians', aliases: ['галатам', 'послание к галатам', 'гал'] },
  { english: 'Ephesians', aliases: ['ефесянам', 'послание к ефесянам', 'ефес', 'еф'] },
  {
    english: 'Philippians',
    aliases: ['филиппийцам', 'послание к филиппийцам', 'филип', 'филп', 'флп'],
  },
  {
    english: 'Colossians',
    aliases: ['колоссянам', 'послание к колоссянам', 'колос', 'кол'],
  },
  {
    english: '1 Thessalonians',
    aliases: ['1 фессалоникийцам', '1-е послание к фессалоникийцам', '1 фес', '1фес', '1фс'],
  },
  {
    english: '2 Thessalonians',
    aliases: ['2 фессалоникийцам', '2-е послание к фессалоникийцам', '2 фес', '2фес', '2фс'],
  },
  {
    english: '1 Timothy',
    aliases: ['1 тимофею', '1-е послание к тимофею', '1 тим', '1тим', '1т'],
  },
  {
    english: '2 Timothy',
    aliases: ['2 тимофею', '2-е послание к тимофею', '2 тим', '2тим', '2т'],
  },
  { english: 'Titus', aliases: ['титу', 'послание к титу', 'тит'] },
  { english: 'Philemon', aliases: ['филимону', 'послание к филимону', 'филим', 'фил', 'флм'] },
  { english: 'Hebrews', aliases: ['евреям', 'послание к евреям', 'евр', 'евр', 'евр'] },
  { english: 'James', aliases: ['якову', 'послание иакову', 'иакову', 'иак', 'иа'] },
  { english: '1 Peter', aliases: ['1 петра', '1-е послание петра', '1 пет', '1пет', '1п'] },
  { english: '2 Peter', aliases: ['2 петра', '2-е послание петра', '2 пет', '2пет', '2п'] },
  {
    english: '1 John',
    aliases: ['1 иоанна', '1-е послание иоанна', '1 иоан', '1иоан', '1и'],
  },
  {
    english: '2 John',
    aliases: ['2 иоанна', '2-е послание иоанна', '2 иоан', '2иоан', '2и'],
  },
  {
    english: '3 John',
    aliases: ['3 иоанна', '3-е послание иоанна', '3 иоан', '3иоан', '3и'],
  },
  { english: 'Jude', aliases: ['иуде', 'послание иуде', 'иуде', 'иуд', 'иу'] },
  {
    english: 'Revelation',
    aliases: ['откровение иоанна богослова', 'откровение', 'откр', 'отк', 'апокалипсис'],
  },
];

const BOOK_ALIAS_ENTRIES = ORDERED_BOOKS.flatMap(({ english, aliases }) => {
  const normalizedEnglish = english.toLowerCase();
  const compactEnglish = normalizedEnglish.replace(/[^a-z0-9]/g, '');
  const aliasSet = new Set<string>([
    normalizedEnglish,
    english,
    compactEnglish,
    ...aliases.map((alias) => alias.toLowerCase()),
  ]);

  return Array.from(aliasSet).map((alias) => [alias, english] as [string, string]);
});

const BOOK_ALIASES = BOOK_ALIAS_ENTRIES.reduce<Record<string, string>>((acc, [alias, book]) => {
  acc[alias] = book;
  return acc;
}, {});

const resolveBook = (input: string): BookMatch | null => {
  const normalized = input.toLowerCase();
  const direct = BOOK_ALIASES[normalized];
  if (direct) return { book: direct, remaining: [] };

  const found = BIBLE_BOOKS.find((book) => book.toLowerCase().startsWith(normalized));
  if (found) return { book: found, remaining: [] };

  return null;
};

type ParsedReference = Omit<ScriptureReference, 'id'>;

export function parseReferenceText(raw: string): ParsedReference | null {
  const tokens = raw
    .replace(/[:,.;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 3) return null;

  const maybeBookParts: string[] = [];
  const maxBookTokens = Math.min(4, tokens.length - 2);
  for (let i = 1; i <= maxBookTokens; i += 1) {
    maybeBookParts.push(tokens.slice(0, i).join(' '));
  }

  let matched: BookMatch | null = null;
  let consumed = 0;
  for (let i = maybeBookParts.length - 1; i >= 0; i -= 1) {
    const candidate = maybeBookParts[i];
    const res = resolveBook(candidate);
    if (res) {
      matched = res;
      consumed = i + 1;
      break;
    }
  }
  if (!matched) return null;

  const numbers = tokens.slice(consumed).map((t) => Number(t));
  if (numbers.some((n) => Number.isNaN(n) || n <= 0)) return null;
  const [chapter, fromVerse, maybeTo] = numbers;
  if (!chapter || !fromVerse) return null;

  const parsed: ParsedReference = {
    book: matched.book,
    chapter,
    fromVerse,
  };
  if (maybeTo && maybeTo >= fromVerse) {
    parsed.toVerse = maybeTo;
  }

  return parsed;
}
