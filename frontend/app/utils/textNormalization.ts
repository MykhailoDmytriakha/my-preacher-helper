export const capitalizeFirstLetter = (value: string): string => {
  const firstLetterMatch = /\p{L}/u.exec(value);
  if (!firstLetterMatch) return value;

  const firstLetterIndex = firstLetterMatch.index;
  const firstLetter = firstLetterMatch[0];
  const capitalizedFirstLetter = firstLetter.toLocaleUpperCase();

  if (firstLetter === capitalizedFirstLetter) return value;

  return `${value.slice(0, firstLetterIndex)}${capitalizedFirstLetter}${value.slice(firstLetterIndex + firstLetter.length)}`;
};

export const normalizeCapitalizedTitle = (value: string): string =>
  capitalizeFirstLetter(value).trim();

export function changedCapitalizedTitle(value: string, openingTitle: string): string | undefined {
  if (value === openingTitle) return undefined;
  const title = normalizeCapitalizedTitle(value);
  return title && title !== openingTitle ? title : undefined;
}
