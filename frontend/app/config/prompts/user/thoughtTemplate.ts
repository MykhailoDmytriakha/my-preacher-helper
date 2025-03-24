import { Sermon } from "@/models/models";

export function createThoughtUserMessage(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[]
): string {
  return `
    Контекст проповеди:
    Название проповеди: ${sermon.title}
    Текст проповеди: ${sermon.verse}
    Доступные tags: ${availableTags.join(", ")}. ИСПОЛЬЗУЙТЕ ТОЛЬКО ЭТИ tags!
    
    ВАЖНО: Не включайте в результат цитаты из основного текста проповеди (из поля "Текст проповеди"). Генерируйте только мысли и размышления, которые не повторяют исходный текст.
    --------------------------------
    Транскрипция: ${thoughtText}
    --------------------------------
    `;
} 