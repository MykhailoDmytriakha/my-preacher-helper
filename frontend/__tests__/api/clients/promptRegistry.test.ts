import fs from 'fs';
import path from 'path';

import {
  PROMPT_REGISTRY,
  promptDisplayName,
  promptKeysInOrder,
  resolvePromptKey,
} from '@/api/clients/ai/promptRegistry';

/**
 * Реестр имён держится сканером, а не дисциплиной: список выводится из кода в обе
 * стороны. Промпт без записи в реестре роняет сборку, и запись без промпта — тоже,
 * иначе реестр тихо расходится с тем, что реально вызывается.
 */

const API_DIR = path.join(process.cwd(), 'app', 'api');

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('prompt registry', () => {
  const sources = collectTsFiles(API_DIR).map((file) => ({
    file: path.relative(process.cwd(), file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8'),
  }));

  it('finds the API sources to scan', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('every promptName used in code is described in the registry', () => {
    const unknown: string[] = [];
    for (const { file, text } of sources) {
      for (const match of text.matchAll(/promptName:\s*["']([^"']+)["']/g)) {
        if (!PROMPT_REGISTRY[match[1]]) unknown.push(`${file}: ${match[1]}`);
      }
    }

    // Пусто = у каждого промпта есть область, этап и человеческое имя.
    expect(unknown).toEqual([]);
  });

  it('every registry entry that has a prompt is actually used in code', () => {
    // Сам реестр из выборки исключён: иначе ключ «находится» в собственном
    // объявлении, проверка проходит всегда и не может упасть — поймано мутацией
    // «запись-призрак», которая должна была покраснеть и не покраснела.
    const allSources = sources
      .filter((s) => !s.file.endsWith('ai/promptRegistry.ts'))
      .map((s) => s.text)
      .join('\n');
    const unused = Object.entries(PROMPT_REGISTRY)
      .filter(([, descriptor]) => descriptor.hasPrompt)
      .map(([key]) => key)
      .filter((key) => !allSources.includes(`"${key}"`) && !allSources.includes(`'${key}'`));

    // Пусто = в реестре нет выдуманных имён, за которыми ничего не стоит.
    expect(unused).toEqual([]);
  });

  it('keeps steps without a prompt marked, so the map does not promise data it has no way to collect', () => {
    expect(PROMPT_REGISTRY['sermon.thoughts.transcribe'].hasPrompt).toBe(false);
    expect(PROMPT_REGISTRY['dictation.transcribe'].hasPrompt).toBe(false);
  });

  it('maps legacy names onto current keys so accumulated history does not split', () => {
    expect(resolvePromptKey('plan_point_content')).toBe('sermon.conspect.point');
    expect(resolvePromptKey('thought')).toBe('sermon.thoughts.transcript_polish');
    expect(resolvePromptKey('polishTranscription')).toBe('dictation.transcript_cleanup');
    expect(resolvePromptKey('studyNoteAnalysis')).toBe('studies.note.analyze_all');
    // Уже переименованный ключ проходит насквозь.
    expect(resolvePromptKey('sermon.conspect.point')).toBe('sermon.conspect.point');
    // Незнакомое имя возвращается как есть: показать сырое честнее, чем промолчать.
    expect(resolvePromptKey('who_is_this')).toBe('who_is_this');
  });

  it('gives every name observed in production telemetry a home', () => {
    // Имена, под которыми события реально лежат в ai_prompt_telemetry (замер 2026-07-27).
    const observed = [
      'thought',
      'plan_point_content',
      'compose_plan_from_scratch',
      'polishTranscription',
      'sermon_transitions',
      'studyNoteAnalysis',
      'speech_optimization',
      'sermon_points',
    ];
    const orphans = observed.filter((name) => !PROMPT_REGISTRY[resolvePromptKey(name)]);

    expect(orphans).toEqual([]);
  });

  it('shows a human name for old and new names alike', () => {
    expect(promptDisplayName('plan_point_content')).toBe('Проповедь · План · текст одного пункта');
    expect(promptDisplayName('sermon.export.part_links'))
      .toBe('Проповедь · Экспорт · вступление, связки между частями, концовка');
  });

  it('orders keys by area, then by step within the area', () => {
    const order = promptKeysInOrder();

    expect(order[0]).toBe('sermon.scratch.to_outline');
    expect(order.indexOf('sermon.thoughts.transcribe'))
      .toBeLessThan(order.indexOf('sermon.thoughts.transcript_polish'));
    expect(order.indexOf('sermon.conspect.section'))
      .toBeLessThan(order.indexOf('sermon.export.speech_text'));
    // Области идут в порядке «проповедь → диктовка → изучение».
    expect(order.indexOf('dictation.transcribe')).toBeGreaterThan(order.indexOf('sermon.export.part_links'));
    expect(order.indexOf('studies.note.analyze_all')).toBeGreaterThan(order.indexOf('dictation.transcript_cleanup'));
  });
});
