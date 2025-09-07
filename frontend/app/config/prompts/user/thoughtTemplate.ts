import { Sermon, Thought } from "@/models/models";

const MAX_EXAMPLE_THOUGHTS = 20; // Define a limit for examples

export function createThoughtUserMessage(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[],
  exampleThoughts: Pick<Thought, 'text' | 'tags'>[]
): string {
  // Take only the last MAX_EXAMPLE_THOUGHTS examples
  const limitedExamples = exampleThoughts.slice(-MAX_EXAMPLE_THOUGHTS);

  // Format the limited examples
  const examplesString = limitedExamples.length > 0 
    ? `\n${limitedExamples
        .map(example => `- Мысль: \"${example.text}\" - Теги: [${example.tags.join(', ')}]`)
        .join('\n')}\n`
    : '';

  return `
    Контекст проповеди:
    Название проповеди: ${sermon.title}
    Текст проповеди: ${sermon.verse}
    Доступные tags: ${availableTags.join(", ")}. ИСПОЛЬЗУЙТЕ ТОЛЬКО ЭТИ tags!
    Вот примеры существующих мыслей с тегами (для образца):
    ${examplesString} 

    ВАЖНО:
    - Не включайте в результат цитаты из основного текста проповеди (из поля "Текст проповеди"). Генерируйте только мысли и размышления, которые не повторяют исходный текст.
    - Если предложение содержит явную цитату, парафразу или явный намёк на конкретный библейский стих, ДОБАВЬТЕ ссылку на этот стих в конце предложения в формате (Книга N:М). Ссылку можно добавлять даже на основной стих проповеди, но сам текст стиха не приводите.
    - Если в транскрипции есть перечисления (например: "первое/во‑первых", "второе/во‑вторых", "третье", либо форматы "1.", "1)"), оформите их как нумерованный список, по одному пункту на строку: "1. …", "2. …". Сохраните порядок и количество пунктов. Вводное предложение оставьте отдельной строкой над списком.
    --------------------------------
    Транскрипция: ${thoughtText}
    --------------------------------
    `;
} 
