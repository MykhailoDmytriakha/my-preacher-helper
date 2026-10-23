/**
 * TYPED WITH THE ENGLISH LAYOUT ON: «by 3^16» on a Russian keyboard is «ин 3:16». The letters are
 * turned key for key into the layout of the Bible's language; «^» is the Russian and Ukrainian
 * layouts' «:» (Shift+6). Only text with Latin letters and no Cyrillic is turned — the caller keeps
 * the turned text only when the line understands it.
 */
const ENGLISH_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const LAYOUTS = {
  ru: 'йцукенгшщзхъфывапролджэячсмитьбюё',
  uk: "йцукенгшщзхїфівапролджєячсмитьбю'",
} as const;

export type CyrillicLayout = keyof typeof LAYOUTS;

const keyMaps = Object.fromEntries(
  Object.entries(LAYOUTS).map(([language, letters]) => [language, new Map([...ENGLISH_KEYS].map((key, index) => [key, letters[index]]))])
) as Record<CyrillicLayout, Map<string, string>>;

/** The text as the Cyrillic layout would have typed it, or null when it is not text typed in the wrong layout. */
export function fromEnglishLayout(raw: string, layout: CyrillicLayout): string | null {
  if (/[\p{Script=Cyrillic}]/u.test(raw) || !/[a-z]/i.test(raw)) return null;
  const keys = keyMaps[layout];
  // A run of key characters with at least one letter: «3^16» and «-» between numbers stay as they are.
  return raw
    .replace(/\^/g, ':')
    .replace(/[a-z[\];',.`]*[a-z][a-z[\];',.`]*/gi, (run) => [...run].map((char) => {
      const turned = keys.get(char.toLowerCase());
      if (!turned) return char;
      return char === char.toLowerCase() ? turned : turned.toUpperCase();
    }).join(''));
}
