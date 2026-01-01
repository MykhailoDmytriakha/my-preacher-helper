const toLinearChannel = (value: number) => {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
};

const parseHexColor = (bgColor: string) => {
  if (!bgColor) return null;
  const cleaned = bgColor.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const normalized = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
};

export const getContrastColor = (bgColor: string): string => {
  const rgb = parseHexColor(bgColor);
  if (!rgb) return '#fff';

  const r = toLinearChannel(rgb.r);
  const g = toLinearChannel(rgb.g);
  const b = toLinearChannel(rgb.b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  const contrastWithWhite = (1.05) / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;

  return contrastWithBlack >= contrastWithWhite ? '#000' : '#fff';
};
