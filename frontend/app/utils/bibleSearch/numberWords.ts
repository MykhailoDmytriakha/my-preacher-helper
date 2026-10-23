/**
 * NUMBERS SAID IN WORDS, as dictation sometimes writes them: «Иоанна три шестнадцать» is John 3:16,
 * «двадцать третий псалом» Psalm 23, «John three sixteen» the same place. Russian, Ukrainian and
 * English, cardinals and ordinals, up to the numbers a chapter and a verse need (Psalm 119:176).
 * Words are compared as `normalizeWord` gives them: lower case, «ё» as «е», no apostrophe («п'ять» — «пять»).
 */
const UNITS: Readonly<Record<string, number>> = {
  // Russian
  один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
  восемнадцать: 18, девятнадцать: 19,
  // Ukrainian (the same words as Russian are not repeated)
  одне: 1, дві: 2, чотири: 4, шість: 6, сім: 7, вісім: 8, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14,
  пятнадцять: 15, шістнадцять: 16, сімнадцять: 17, вісімнадцять: 18, девятнадцять: 19,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  двадцять: 20, тридцять: 30, пятдесят: 50, шістдесят: 60, сімдесят: 70, вісімдесят: 80,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const HUNDREDS: Readonly<Record<string, number>> = { сто: 100, двести: 200, двісті: 200, hundred: 100 };

/** Ordinal stems with the number they stand for; an ending follows («третья», «шістнадцятий», «sixteenth»). */
const ORDINAL_STEMS: ReadonlyArray<readonly [string, number]> = [
  ['перв', 1], ['втор', 2], ['трет', 3], ['четверт', 4], ['пят', 5], ['шест', 6], ['седьм', 7], ['восьм', 8], ['девят', 9],
  ['десят', 10], ['одиннадцат', 11], ['двенадцат', 12], ['тринадцат', 13], ['четырнадцат', 14], ['пятнадцат', 15],
  ['шестнадцат', 16], ['семнадцат', 17], ['восемнадцат', 18], ['девятнадцат', 19], ['двадцат', 20], ['тридцат', 30],
  ['сороков', 40], ['пятидесят', 50], ['шестидесят', 60], ['семидесят', 70], ['восьмидесят', 80], ['девяност', 90], ['сот', 100],
  ['перш', 1], ['друг', 2], ['шост', 6], ['сьом', 7], ['одинадцят', 11], ['дванадцят', 12], ['тринадцят', 13],
  ['чотирнадцят', 14], ['пятнадцят', 15], ['шістнадцят', 16], ['сімнадцят', 17], ['вісімнадцят', 18], ['девятнадцят', 19],
  ['двадцят', 20], ['тридцят', 30],
];
const ORDINAL_ENDING = /^(ая|ой|ую|ый|ое|ья|ье|ий|ей|ом|ого|ему|ому|а|е|я|є|ій|им|ім|ої)$/;
const ENGLISH_ORDINALS: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50,
};

/** The number an ordinal word says, or null: «третья» 3, «шістнадцятий» 16, «sixteenth» 16; «второзаконие» is none. */
export function ordinalOf(word: string): number | null {
  if (word in ENGLISH_ORDINALS) return ENGLISH_ORDINALS[word];
  let best: readonly [string, number] | null = null;
  for (const entry of ORDINAL_STEMS) {
    const [stem] = entry;
    if (word.startsWith(stem) && ORDINAL_ENDING.test(word.slice(stem.length)) && (!best || stem.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

const cardinal = (word: string): { value: number; kind: 'unit' | 'ten' | 'hundred' } | null => {
  if (word in UNITS) return { value: UNITS[word], kind: 'unit' };
  if (word in TENS) return { value: TENS[word], kind: 'ten' };
  if (word in HUNDREDS) return { value: HUNDREDS[word], kind: 'hundred' };
  return null;
};

/** Whether a word is a number said in words. */
export const isNumberWord = (word: string): boolean => cardinal(word) !== null || ordinalOf(word) !== null;

/**
 * Words with the numbers said in them turned into digits, each run of number words one number:
 * «три шестнадцать» → 3 16, «сто девятнадцать» → 119, «двадцать третий» → 23, «one hundred nineteen» → 119.
 * Every other word stays as it is.
 */
export function digitsForNumberWords(words: readonly string[]): string[] {
  const out: string[] = [];
  let sum: number | null = null;
  let last: 'unit' | 'ten' | 'hundred' | null = null;
  const flush = () => {
    if (sum !== null) out.push(String(sum));
    sum = null;
    last = null;
  };
  for (const word of words) {
    const number = cardinal(word);
    if (number) {
      if (number.kind === 'hundred') {
        // «сто» starts a number; «one hundred» multiplies the unit before it.
        if (sum !== null && last === 'unit' && sum < 10 && word === 'hundred') sum *= 100;
        else { flush(); sum = number.value; }
        last = 'hundred';
      } else if (sum !== null && ((last === 'hundred' && number.value < 100) || (last === 'ten' && number.kind === 'unit' && number.value < 10))) {
        sum += number.value;
        last = number.kind;
      } else {
        flush();
        sum = number.value;
        last = number.kind;
      }
      continue;
    }
    const ordinal = ordinalOf(word);
    if (ordinal !== null) {
      // An ordinal ends its number: «двадцать третий» is 23, and the next word starts anew.
      if (sum !== null && ((last === 'ten' && ordinal < 10) || (last === 'hundred' && ordinal < 100))) {
        out.push(String(sum + ordinal));
        sum = null;
        last = null;
      } else {
        flush();
        out.push(String(ordinal));
      }
      continue;
    }
    flush();
    out.push(word);
  }
  flush();
  return out;
}
