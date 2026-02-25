import { Sermon, Thought } from "@/models/models";

const MAX_EXAMPLE_THOUGHTS = 5;
const MAX_EXAMPLE_CHARS = 300;

export function createThoughtUserMessage(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[],
  exampleThoughts: Pick<Thought, 'text' | 'tags'>[]
): string {
  const limitedExamples = exampleThoughts.slice(-MAX_EXAMPLE_THOUGHTS);

  const examplesString = limitedExamples.length > 0
    ? `\n${limitedExamples
        .map(example => {
          const text = example.text.length > MAX_EXAMPLE_CHARS
            ? `${example.text.slice(0, MAX_EXAMPLE_CHARS)}…`
            : example.text;
          return `- Мысль: "${text}" - Теги: [${example.tags.join(', ')}]`;
        })
        .join('\n')}\n`
    : '';

  return `Контекст проповеди:
Название: ${sermon.title}
Текст: ${sermon.verse}
Теги: ${availableTags.join(', ')}
Примеры существующих мыслей:${examplesString}
--------------------------------
Транскрипция: ${thoughtText}
--------------------------------`;
} 
