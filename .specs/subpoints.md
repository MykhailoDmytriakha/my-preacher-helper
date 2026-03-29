# Feature: SubPoints (подпункты внутри Outline Points)

## Статус: Проектирование

## Проблема

Проповедник мыслит **скелетом** — внутренней структурой проповеди. Сейчас скелет ограничен одним уровнем: Section → OutlinePoint → Thoughts. Это вынуждает проповедника:

- Создавать 6-7 outline points вместо логичной 2-уровневой структуры
- Терять внутреннюю иерархию, когда outline points разрастаются
- Получать некачественную AI-генерацию плана, потому что AI не знает внутреннюю структуру outline point
- Испытывать дискомфорт при проповедовании — скелет не отражает то, что у него в голове

## Решение

Добавить опциональный уровень **SubPoint** внутри OutlinePoint. SubPoints — это подзаголовки/подтемы, которые формируют внутренний скелет outline point.

## Модель данных

### Текущая иерархия
```
Section (introduction / main / conclusion)
  └── OutlinePoint
        └── Thought (через outlinePointId + position)
```

### Новая иерархия
```
Section (introduction / main / conclusion)
  └── OutlinePoint
        ├── Thought (напрямую, subPointId = null)
        ├── SubPoint
        │     ├── Thought (subPointId = id этого sub-point)
        │     └── Thought
        ├── Thought (напрямую, между sub-points)
        └── SubPoint
              └── Thought
```

### Пример реального использования
```
OutlinePoint: "Искупление через жертву"
  ├── [pos: 1000] Thought: "Зачитать Левит 16:15-16"     → subPointId: null
  ├── [pos: 2000] Thought: "Контекст жертвоприношения"    → subPointId: null
  ├── [pos: 3000] SubPoint: "Ветхозаветный прообраз"
  │     ├── [pos: 1000] Thought: "Агнец без порока"
  │     └── [pos: 2000] Thought: "Кровь покрывает грех"
  ├── [pos: 4000] SubPoint: "Исполнение во Христе"
  │     ├── [pos: 1000] Thought: "Иоанн 1:29"
  │     └── [pos: 2000] Thought: "Однажды и навсегда"
  └── [pos: 5000] Thought: "Переход к применению"         → subPointId: null
```

### Новые/изменённые типы

```typescript
// НОВЫЙ тип
interface SubPoint {
  id: string;
  text: string;
  position: number;         // позиция среди siblings в outline point
  outlinePointId: string;   // родительский outline point
}

// ИЗМЕНЕНИЕ в OutlinePoint — добавляется поле subPoints
interface OutlinePoint {
  id: string;
  text: string;
  isReviewed: boolean;
  subPoints?: SubPoint[];   // НОВОЕ: вложенные подпункты
}

// ИЗМЕНЕНИЕ в Thought — добавляется поле subPointId
interface Thought {
  // ...все существующие поля...
  subPointId?: string | null;  // НОВОЕ: если мысль внутри sub-point
}

// ИЗМЕНЕНИЕ в ThoughtInStructure (Item) — добавляется поле subPointId
interface ThoughtInStructure {
  // ...все существующие поля...
  subPointId?: string | null;  // НОВОЕ
}
```

### Позиционирование

Внутри одного OutlinePoint сосуществуют два типа элементов:
- **Мысли без subPointId** — позиционируются по `thought.position`
- **SubPoints** — позиционируются по `subPoint.position`

Оба типа живут в **едином пространстве position** внутри outline point. Это обеспечивает порядок: мысль → sub-point → мысль → sub-point → мысль.

Мысли **внутри** sub-point имеют свой отдельный `position` (порядок внутри контейнера sub-point).

### Firestore: обратная совместимость

- `Thought.subPointId` — опциональное поле, для существующих мыслей `undefined` → работают как раньше
- `OutlinePoint.subPoints` — опциональный массив, для существующих outline points `undefined` → работают как раньше
- **Миграция не нужна** — старые данные валидны в новой модели

## Этапы внедрения

### Этап 1: Модель данных + Firestore + CRUD
- [ ] Добавить `SubPoint` интерфейс в `models.ts`
- [ ] Расширить `OutlinePoint` полем `subPoints?: SubPoint[]`
- [ ] Расширить `Thought` и `ThoughtInStructure` полем `subPointId?: string | null`
- [ ] Обновить `sermons.repository.ts` — сохранение/чтение sub-points в составе outline
- [ ] API endpoint для CRUD sub-points (или через existing outline endpoint)
- [ ] Проверить обратную совместимость — старые проповеди работают без sub-points

### Этап 2: UI отображения в Structure page
- [ ] Рендеринг sub-points как вложенных групп внутри outline point в `Column.tsx`
- [ ] Визуальная иерархия: outline point → sub-point (отступ/стиль)
- [ ] Мысли до/между/после sub-points видны на своих позициях
- [ ] Создание/редактирование/удаление sub-points (UI controls)
- [ ] Переупорядочивание sub-points (drag handle или стрелки)

### Этап 3: DnD интеграция
- [ ] Перетаскивание мыслей в/из sub-points
- [ ] Drop targets: sub-point как контейнер, пространство outline point вне sub-points
- [ ] Обновление `useStructureDnd.ts` — определение destination (outline point vs sub-point)
- [ ] Обновление position calculation для двух уровней
- [ ] Перетаскивание sub-points целиком (с содержимым)

### Этап 4: AI сортировка
- [ ] Обновить system prompt (`sorting.ts`) — описание 3-уровневой иерархии
- [ ] Обновить user prompt template (`sortingTemplate.ts`) — включить sub-points
- [ ] Расширить `SortingResponseSchema` полем `subPoint`
- [ ] Обновить `openAI.client.ts` — парсинг нового формата ответа
- [ ] Обновить `useAiSortingDiff.ts` — diff mode с учётом sub-point назначений
- [ ] AI должен уметь: назначить в sub-point ИЛИ напрямую в outline point

### Этап 5: Генерация контента (план/draft)
- [ ] Обновить структуру `SermonContent` — sub-points в outline content
- [ ] Обновить промпты генерации плана — учитывать sub-points
- [ ] Обновить `updateSermonContent()` — сохранение контента по sub-points
- [ ] Обратная совместимость — старые проповеди без sub-points генерируются как раньше

### Этап 6: Режим проповеди (conduct) и отображение
- [ ] Скелет с sub-points отображается при проповедовании
- [ ] Навигация учитывает sub-point уровень
- [ ] Plan view — sub-points в финальном отображении

## Камни преткновения

### 1. Позиционирование двух типов сущностей на одном уровне
**Проблема**: Мысли (без subPointId) и SubPoints делят одно position-пространство внутри outline point.
**Решение**: Единое fractional positioning. При рендере — merge + sort by position обоих списков.

### 2. DnD с вложенными контейнерами
**Проблема**: dnd-kit nested containers значительно сложнее плоских.
**Решение**: Sub-point как droppable zone внутри outline point droppable. Чёткие collision detection boundaries.

### 3. AI должен понимать опциональность sub-points
**Проблема**: Некоторые outline points имеют sub-points, некоторые нет. AI должен это учитывать.
**Решение**: В промпте явно указывать структуру каждого outline point. Если sub-points есть — AI назначает в них. Если нет — назначает напрямую.

### 4. Генерация плана с неоднородной структурой
**Проблема**: Один outline point может иметь sub-points, соседний — нет. План должен это отражать.
**Решение**: Условная генерация — если sub-points есть, генерируем per-sub-point. Если нет — как сейчас.

## Тестовая стратегия

- Тестовый Firebase аккаунт для разработки
- Unit тесты на position calculation с sub-points
- Unit тесты на обратную совместимость (данные без sub-points)
- Integration тесты AI сортировки с sub-points
- Ручное тестирование DnD (вложенные контейнеры сложно покрыть автотестами)

## Файлы, затронутые фичей

| Файл | Изменение |
|------|-----------|
| `models/models.ts` | SubPoint тип, расширение OutlinePoint, Thought, ThoughtInStructure |
| `components/Column.tsx` | Рендеринг sub-point групп |
| `components/SortableItem.tsx` | Отображение sub-point привязки |
| `sermons/[id]/structure/page.tsx` | Интеграция sub-points в state |
| `structure/hooks/useStructureDnd.ts` | DnD с вложенными контейнерами |
| `structure/hooks/useAiSortingDiff.ts` | AI diff с sub-points |
| `structure/hooks/usePersistence.ts` | Сохранение subPointId |
| `structure/hooks/useSermonActions.ts` | CRUD actions для sub-points |
| `structure/utils/structure.ts` | Position calculation, build helpers |
| `config/prompts/system/sorting.ts` | System prompt |
| `config/prompts/user/sortingTemplate.ts` | User prompt template |
| `api/clients/openAI.client.ts` | Sorting response parsing |
| `api/repositories/sermons.repository.ts` | Firestore read/write |
| `services/sortAI.service.ts` | Sort service |
| `utils/aiSorting.ts` | Validation rules |
| `locales/{en,ru,uk}/translation.json` | i18n ключи для sub-points UI |
