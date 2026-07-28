/**
 * Реестр AI-промптов: ключ → где это в приложении и на каком шаге.
 *
 * Зачем. Имя вида `plan_point_content` ничего не говорит о том, на какой странице
 * и в каком месте работы оно случилось, — а именно это нужно, когда смотришь
 * телеметрию и решаешь, что чинить. Ключ теперь называет ОБЛАСТЬ и ЭТАП
 * (`sermon.conspect.point`), а реестр держит человеческое имя, порядок шага и
 * точку в интерфейсе.
 *
 * Область — это раздел приложения: проповедь · изучение · общая диктовка.
 * (Серии, группы, молитва и календарь собственных промптов не имеют; диктовку
 * из молитвы обслуживает общий `dictation.*`.)
 *
 * `legacyNames` держит имена, под которыми события уже накоплены в
 * `ai_prompt_telemetry`. Благодаря им переименование не рвёт историю: сводка
 * сводит старое и новое в одну строку через `resolvePromptKey`.
 *
 * Новый промпт без записи здесь роняет `__tests__/api/clients/promptRegistry.test.ts`:
 * список выводится из кода, а не поддерживается руками.
 */

export type PromptArea = "sermon" | "dictation" | "studies";

export interface PromptDescriptor {
  /** Область приложения. */
  area: PromptArea;
  /** «Проповедь» · «Диктовка» · «Изучение». */
  areaLabel: string;
  /** «Мысли» · «Конспект» · «Экспорт». */
  stageLabel: string;
  /** Номер шага внутри области — по нему сортируется вывод. */
  step: string;
  /** Что человек увидит вместо ключа. */
  display: string;
  /** Где именно в интерфейсе это происходит. */
  where: string;
  /**
   * Есть ли у шага текстовый промпт. У расшифровки его нет — она идёт
   * аудио-моделью, поэтому в телеметрии событий под этим ключом не будет.
   * Шаг вписан, чтобы карта работы была полной, а не чтобы обещать данные.
   */
  hasPrompt: boolean;
  /** Имена, под которыми события лежат в базе до переименования. */
  legacyNames: string[];
}

export const PROMPT_REGISTRY: Record<string, PromptDescriptor> = {
  // ── Проповедь ───────────────────────────────────────────────────────────
  "sermon.scratch.to_outline": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Наброски",
    step: "1",
    display: "Проповедь · Наброски · разложить наброски в план",
    where: "режим «Наброски» → «Работать над планом»",
    hasPrompt: true,
    legacyNames: ["compose_plan_from_scratch"],
  },
  "sermon.thoughts.transcribe": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Мысли",
    step: "2.1",
    display: "Проповедь · Мысли · расшифровка записи",
    where: "«Новая запись» на странице проповеди",
    hasPrompt: false,
    legacyNames: [],
  },
  "sermon.thoughts.transcript_polish": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Мысли",
    step: "2.2",
    display: "Проповедь · Мысли · диктовка → мысль (проза + теги)",
    where: "«Новая запись», сразу за расшифровкой",
    hasPrompt: true,
    legacyNames: ["thought"],
  },
  "sermon.ideas.suggest": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Идеи",
    step: "2.9",
    display: "Проповедь · Идеи · подсказка, когда застрял",
    where: "Классический режим → «Идеи» → «Создать»",
    hasPrompt: true,
    legacyNames: ["brainstorm_suggestion"],
  },
  "sermon.insights.all": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Размышления",
    step: "3.1",
    display: "Проповедь · Размышления · всё сразу",
    where: "Классический → «Размышления над проповедью» → «Сгенерировать»",
    hasPrompt: true,
    legacyNames: ["sermon_insights"],
  },
  "sermon.insights.topics": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Размышления",
    step: "3.2",
    display: "Проповедь · Размышления · темы",
    where: "«Размышления над проповедью» → обновление у блока «Темы»",
    hasPrompt: true,
    legacyNames: ["sermon_topics"],
  },
  "sermon.insights.verses": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Размышления",
    step: "3.3",
    display: "Проповедь · Размышления · стихи",
    where: "«Размышления над проповедью» → обновление у блока «Стихи»",
    hasPrompt: true,
    legacyNames: ["sermon_verses"],
  },
  "sermon.insights.directions": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Размышления",
    step: "3.4",
    display: "Проповедь · Размышления · направления",
    where: "«Размышления над проповедью» → обновление у блока «Направления»",
    hasPrompt: true,
    legacyNames: ["sermon_directions"],
  },
  "sermon.insights.section_hints": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Размышления",
    step: "3.5",
    display: "Проповедь · Размышления · предположенный план",
    where: "«Размышления над проповедью» → обновление у блока «Предположенный план»",
    hasPrompt: true,
    legacyNames: ["section_hints"],
  },
  "sermon.structure.focus.generate_outline": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Структура",
    step: "4",
    display: "Проповедь · Структура · режим фокуса · создать пункты плана",
    where: "страница структуры → режим фокуса → сайдбар «Пункты плана» → «Создать»",
    hasPrompt: true,
    legacyNames: ["sermon_points"],
  },
  "sermon.structure.sort": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Структура",
    step: "5",
    display: "Проповедь · Структура · разложить мысли по пунктам",
    where: "страница структуры → AI-сортировка",
    hasPrompt: true,
    legacyNames: ["sort_items"],
  },
  "sermon.conspect.section": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Конспект",
    step: "6.1",
    display: "Проповедь · Конспект · текст раздела",
    where: "«Конспект проповеди» → «Сгенерировать» у раздела",
    hasPrompt: true,
    legacyNames: ["plan_for_section"],
  },
  "sermon.conspect.point": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Конспект",
    step: "6.2",
    display: "Проповедь · Конспект · текст одного пункта",
    where: "«Конспект проповеди» → «Сгенерировать» у пункта",
    hasPrompt: true,
    legacyNames: ["plan_point_content"],
  },
  "sermon.export.speech_text": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Экспорт",
    step: "7.1",
    display: "Проповедь · Экспорт · текст под озвучку",
    where: "экспорт аудио → оптимизация речи",
    hasPrompt: true,
    legacyNames: ["speech_optimization"],
  },
  "sermon.export.part_links": {
    area: "sermon",
    areaLabel: "Проповедь",
    stageLabel: "Экспорт",
    step: "7.2",
    display: "Проповедь · Экспорт · вступление, связки между частями, концовка",
    where: "экспорт аудио → генерация переходов",
    hasPrompt: true,
    legacyNames: ["sermon_transitions"],
  },

  // ── Диктовка (общая: мысль-модалки, молитва, заметки) ───────────────────
  "dictation.transcribe": {
    area: "dictation",
    areaLabel: "Диктовка",
    stageLabel: "Расшифровка",
    step: "1",
    display: "Диктовка · расшифровка записи",
    where: "любое поле с записью голоса: мысль, обновление молитвы, заметка",
    hasPrompt: false,
    legacyNames: [],
  },
  "dictation.transcript_cleanup": {
    area: "dictation",
    areaLabel: "Диктовка",
    stageLabel: "Расшифровка",
    step: "2",
    display: "Диктовка · вычитка расшифровки (без тегов)",
    where: "любое поле с записью голоса: мысль, обновление молитвы, заметка",
    hasPrompt: true,
    legacyNames: ["polishTranscription"],
  },

  // ── Изучение ────────────────────────────────────────────────────────────
  "studies.note.analyze_all": {
    area: "studies",
    areaLabel: "Изучение",
    stageLabel: "Заметка",
    step: "1",
    display: "Изучение · Заметка · разобрать целиком",
    where: "заметка → «Разобрать»",
    hasPrompt: true,
    // Раньше все четыре разбора писались под одним именем и были неразличимы.
    legacyNames: ["studyNoteAnalysis"],
  },
  "studies.note.analyze_title": {
    area: "studies",
    areaLabel: "Изучение",
    stageLabel: "Заметка",
    step: "2.1",
    display: "Изучение · Заметка · только заголовок",
    where: "заметка → точечный разбор заголовка",
    hasPrompt: true,
    legacyNames: [],
  },
  "studies.note.analyze_tags": {
    area: "studies",
    areaLabel: "Изучение",
    stageLabel: "Заметка",
    step: "2.2",
    display: "Изучение · Заметка · только теги",
    where: "заметка → точечный разбор тегов",
    hasPrompt: true,
    legacyNames: [],
  },
  "studies.note.analyze_refs": {
    area: "studies",
    areaLabel: "Изучение",
    stageLabel: "Заметка",
    step: "2.3",
    display: "Изучение · Заметка · только ссылки на Писание",
    where: "заметка → точечный разбор ссылок",
    hasPrompt: true,
    legacyNames: [],
  },
};

/** Старое имя → новый ключ. Строится из реестра, руками не поддерживается. */
export const LEGACY_PROMPT_KEYS: Record<string, string> = Object.entries(PROMPT_REGISTRY)
  .reduce<Record<string, string>>((acc, [key, descriptor]) => {
    descriptor.legacyNames.forEach((legacy) => {
      acc[legacy] = key;
    });
    return acc;
  }, {});

/**
 * Приводит имя из телеметрии к текущему ключу: события, записанные до
 * переименования, попадают в ту же строку сводки, что и новые.
 */
export function resolvePromptKey(name: string): string {
  if (PROMPT_REGISTRY[name]) return name;
  return LEGACY_PROMPT_KEYS[name] ?? name;
}

/** Описание промпта по имени — старому или новому. `null`, если имени нет в реестре. */
export function describePrompt(name: string): PromptDescriptor | null {
  return PROMPT_REGISTRY[resolvePromptKey(name)] ?? null;
}

/** Человеческое имя для показа. Незнакомое имя возвращается как есть — молчать хуже. */
export function promptDisplayName(name: string): string {
  return describePrompt(name)?.display ?? name;
}

/** Ключи по порядку: сперва область, внутри — номер шага. */
export function promptKeysInOrder(): string[] {
  const areaOrder: PromptArea[] = ["sermon", "dictation", "studies"];
  return Object.keys(PROMPT_REGISTRY).sort((a, b) => {
    const left = PROMPT_REGISTRY[a];
    const right = PROMPT_REGISTRY[b];
    const byArea = areaOrder.indexOf(left.area) - areaOrder.indexOf(right.area);
    if (byArea !== 0) return byArea;
    return left.step.localeCompare(right.step, undefined, { numeric: true });
  });
}
