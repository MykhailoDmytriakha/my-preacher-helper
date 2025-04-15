import { Sermon, Thought } from "@/models/models";

const MAX_EXAMPLE_THOUGHTS = 10; // Define a limit for examples

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

    ВАЖНО: Не включайте в результат цитаты из основного текста проповеди (из поля "Текст проповеди"). Генерируйте только мысли и размышления, которые не повторяют исходный текст.
    --------------------------------
    Транскрипция: ${thoughtText}
    --------------------------------
    `;
} 