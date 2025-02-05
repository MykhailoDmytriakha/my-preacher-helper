export const defaultTags = [
  { id: 'intro', name: 'Вступление', color: '#4F46E5' },
  { id: 'main', name: 'Основная часть', color: '#059669' },
  { id: 'conclusion', name: 'Заключение', color: '#DC2626' },
];

let customTags: { id: string; name: string; color: string }[] = [];

export function getTags() {
  return {
    requiredTags: defaultTags,
    customTags,
  };
}

export function addCustomTag(tag: { id: string; name: string; color: string }) {
  customTags.push(tag);
  return tag;
} 