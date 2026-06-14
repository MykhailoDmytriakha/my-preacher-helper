/**
 * Zod schema for plan point content structured output (v9).
 *
 * The model no longer writes free markdown (that let it drift into essay-mode and
 * rephrase the author's living words into textbook abstractions). Instead it fills
 * discrete fields — the STRUCTURE carries the form, so the cue sheet is always the
 * same shape, and `cues: string[]` physically prevents explanatory prose. A
 * deterministic assembler turns these fields into the markdown the UI already renders.
 */
import { z } from "zod";

/**
 * One group of recall cues. Without sub-points there is exactly one group
 * (heading = null). With sub-points there is one group per sub-point.
 */
export const PlanCueGroupSchema = z.object({
  heading: z
    .string()
    .nullable()
    .describe(
      "Заголовок группы = текст sub-point, ЕСЛИ во входе дана SUB-POINTS STRUCTURE (одна группа на каждый sub-point). Если sub-points нет — null (одна группа на всю точку)."
    ),
  cues: z
    .array(z.string())
    .describe(
      "2-5 коротких триггеров ДОСЛОВНЫМИ живыми словами автора. НЕ перефразируй в книжные абстракции: «велосипед не работал» это НЕ «неисправный механизм»; «возомнил себя мастером» это НЕ «ощущение мастерства». Бери слова автора как есть."
    ),
});

/**
 * Schema for AI-generated plan point content.
 * Returns a preacher cue card as discrete fields; assembled into markdown downstream.
 */
export const PlanPointContentResponseSchema = z.object({
  anchor: z
    .string()
    .describe(
      "Образ-якорь = заголовок всей точки: самое конкретное яркое существительное или сцена из мысли автора (велосипед, два барана, краеугольный камень). Если явного образа/истории нет — сильнейшее конкретное слово или связка автора. НИКОГДА не выдумывай метафору, которой нет в тексте."
    ),
  groups: z
    .array(PlanCueGroupSchema)
    .describe(
      "Группы триггеров. Без sub-points — ровно одна группа (heading=null). С sub-points — по одной группе на каждый sub-point, heading = его текст."
    ),
  turn: z
    .string()
    .nullable()
    .describe(
      "Поворот/кульминация дословными словами автора, например «возомнил мастером → лишняя деталь → не едет». null если поворота нет."
    ),
  refs: z
    .array(z.string())
    .describe(
      "Каждая ссылка несёт текст для распознавания — НИКОГДА не голая ссылка: ссылка + МИНИМУМ 5-7 ключевых слов стиха (узнаваемая выдержка), ЛИБО весь стих целиком, если он короткий или очень ключевой. Формат: «Ис. 66:2: на смиренного и сокрушённого духом». Текст бери из мысли автора, если он его привёл; иначе — ключевые слова самого этого стиха. Цель: проповедник видит 3-4 ссылки и понимает, о чём каждая, не открывая Библию. Не выдумывай НЕсуществующие ссылки. Пусто если ссылок нет."
    ),
});

/**
 * TypeScript type inferred from the Zod schema.
 */
export type PlanPointContentResponse = z.infer<typeof PlanPointContentResponseSchema>;
export type PlanCueGroup = z.infer<typeof PlanCueGroupSchema>;
