# 🔄 План переименования сущностей проекта

**Дата создания:** 17 ноября 2025  
**Статус:** Готов к выполнению  
**Оценка трудозатрат:** 4-6 часов  
**Риск:** Средний (требуется внимательность)

---

## 📋 Сводная таблица переименований

| № | Текущее имя | Новое имя | Приоритет | Сложность | Оценка |
|---|-------------|-----------|-----------|-----------|--------|
| 1 | `Structure` | `ThoughtsBySection` | 🔴 Критичный | Высокая | 99/100 |
| 2 | `Item` | `ThoughtInStructure` | 🔴 Критичный | Средняя | 98/100 |
| 3 | `ThoughtsPlan` | `SectionHints` | 🟡 Важный | Низкая | 97/100 |
| 4 | `Outline` | `SermonOutline` | 🟡 Важный | Средняя | 96/100 |
| 5 | `OutlinePoint` | `SermonPoint` | 🟢 Желательный | Низкая | 96/100 |
| 6 | `Plan` | `SermonDraft` | 🟡 Важный | Средняя | 99/100 |

---

## 🎯 Рекомендуемая последовательность выполнения

### **Фаза 1: Подготовка (30 минут)**
- [ ] Создать новую ветку: `git checkout -b refactor/rename-entities`
- [ ] Убедиться, что все тесты проходят: `npm test`
- [ ] Сделать коммит текущего состояния
- [ ] Прочитать весь план до конца

### **Фаза 2: Простые переименования (1 час)**
Начинаем с сущностей, которые используются реже:

- [ ] **Задача 3:** `ThoughtsPlan` → `SectionHints`
- [ ] **Задача 5:** `OutlinePoint` → `SermonPoint`

### **Фаза 3: Средней сложности (2 часа)**
- [ ] **Задача 2:** `Item` → `ThoughtInStructure`
- [ ] **Задача 6:** `Plan` → `SermonDraft`

### **Фаза 4: Критичные изменения (2-3 часа)**
Требуют максимальной внимательности:

- [ ] **Задача 4:** `Outline` → `SermonOutline`
- [ ] **Задача 1:** `Structure` → `ThoughtsBySection`

### **Фаза 5: Проверка и финализация (30 минут)**
- [ ] Запустить все тесты
- [ ] Проверить линтер
- [ ] Проверить TypeScript ошибки
- [ ] Сделать финальный коммит

---

## 📝 Детальные инструкции по каждой задаче

---

## Задача 1: Structure → ThoughtsBySection

**Приоритет:** 🔴 Критичный  
**Сложность:** Высокая  
**Время:** 90-120 минут  

### Почему это переименование важно:
`Structure` - слишком общее слово. `ThoughtsBySection` четко показывает: "мысли, организованные по секциям проповеди".

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Structure {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
}

// СТАЛО:
export interface ThoughtsBySection {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
}
```

#### 2. Использование в Sermon
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Sermon {
  // ...
  structure?: Structure;
}

// СТАЛО:
export interface Sermon {
  // ...
  thoughtsBySection?: ThoughtsBySection;
}
```

#### 3. API routes

**Файл:** `frontend/app/api/structure/route.ts`
- Переименовать файл: `structure/route.ts` → `thoughts-by-section/route.ts`
- Изменить параметры запроса:

```typescript
// БЫЛО:
const { structure } = await request.json();
await sermonDocRef.update({ structure });

// СТАЛО:
const { thoughtsBySection } = await request.json();
await sermonDocRef.update({ thoughtsBySection });
```

#### 4. Hooks

**Файл:** `frontend/app/hooks/useSermonStructureData.ts`

```typescript
// БЫЛО:
const [structure, setStructure] = useState<Structure>({ 
  introduction: [], 
  main: [], 
  conclusion: [], 
  ambiguous: [] 
});

// СТАЛО:
const [thoughtsBySection, setThoughtsBySection] = useState<ThoughtsBySection>({ 
  introduction: [], 
  main: [], 
  conclusion: [], 
  ambiguous: [] 
});
```

#### 5. Компоненты

Поиск всех использований:
```bash
grep -r "structure" frontend/app/components/ --include="*.tsx" --include="*.ts"
```

Основные файлы:
- `frontend/app/components/Column.tsx`
- `frontend/app/components/SortableItem.tsx`
- `frontend/app/components/sermon/StructureStats.tsx`
- `frontend/app/(pages)/(private)/sermons/[id]/structure/page.tsx`

**Пример изменения в Column.tsx:**

```typescript
// БЫЛО:
interface ColumnProps {
  // ...
  onUpdateStructure?: (structure: Structure) => void;
}

// СТАЛО:
interface ColumnProps {
  // ...
  onUpdateThoughtsBySection?: (thoughtsBySection: ThoughtsBySection) => void;
}
```

#### 6. Services

**Файл:** `frontend/app/services/sortAI.service.ts`

```typescript
// БЫЛО:
export async function sortThoughtsWithAI(
  thoughts: Thought[]
): Promise<Structure> {
  // ...
}

// СТАЛО:
export async function sortThoughtsWithAI(
  thoughts: Thought[]
): Promise<ThoughtsBySection> {
  // ...
}
```

#### 7. Тесты

Найти все тесты:
```bash
find frontend/__tests__ -name "*.test.ts*" -exec grep -l "Structure" {} \;
```

Обновить:
- `frontend/__tests__/api/repositories/sermons-repository.test.ts`
- `frontend/app/hooks/useSermonStructureData.test.ts`
- И другие найденные файлы

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Обновить Sermon interface
- [ ] Переименовать API route файл
- [ ] Обновить все hooks
- [ ] Обновить все компоненты
- [ ] Обновить все services
- [ ] Обновить все тесты
- [ ] Запустить `npm test` - должно пройти
- [ ] Проверить TypeScript: `npx tsc --noEmit`
- [ ] Коммит: `git commit -m "refactor: rename Structure to ThoughtsBySection"`

---

## Задача 2: Item → ThoughtInStructure

**Приоритет:** 🔴 Критичный  
**Сложность:** Средняя  
**Время:** 45-60 минут  

### Почему это переименование важно:
`Item` - слишком общее. `ThoughtInStructure` показывает контекст: мысль в контексте структуры проповеди.

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Item {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
  requiredTags?: string[];
  outlinePoint?: { text: string; section: string };
  outlinePointId?: string | null;
  position?: number;
}

// СТАЛО:
export interface ThoughtInStructure {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
  requiredTags?: string[];
  outlinePoint?: { text: string; section: string };
  outlinePointId?: string | null;
  position?: number;
}
```

#### 2. Компоненты

**Файл:** `frontend/app/components/Column.tsx`

```typescript
// БЫЛО:
interface ColumnProps {
  items: Item[];
  onEdit: (item: Item) => void;
}

// СТАЛО:
interface ColumnProps {
  items: ThoughtInStructure[];
  onEdit: (item: ThoughtInStructure) => void;
}
```

**Файл:** `frontend/app/components/SortableItem.tsx`

```typescript
// БЫЛО:
interface SortableItemProps {
  item: Item;
}

// СТАЛО:
interface SortableItemProps {
  item: ThoughtInStructure;
}
```

#### 3. Хуки и утилиты

**Файл:** `frontend/app/hooks/useSermonStructureData.ts`

Найти все использования `Item` и заменить на `ThoughtInStructure`.

#### 4. Тесты

```bash
grep -r "Item" frontend/__tests__/ --include="*.test.ts*"
```

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Обновить Column.tsx
- [ ] Обновить SortableItem.tsx
- [ ] Обновить все hooks
- [ ] Обновить тесты
- [ ] Запустить `npm test`
- [ ] Коммит: `git commit -m "refactor: rename Item to ThoughtInStructure"`

---

## Задача 3: ThoughtsPlan → SectionHints

**Приоритет:** 🟡 Важный  
**Сложность:** Низкая  
**Время:** 20-30 минут  

### Почему это переименование важно:
`ThoughtsPlan` неясное название. `SectionHints` четко показывает: подсказки AI для каждой секции.

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface ThoughtsPlan {
  introduction: string;
  main: string;
  conclusion: string;
}

// СТАЛО:
export interface SectionHints {
  introduction: string;
  main: string;
  conclusion: string;
}
```

#### 2. Использование в Insights
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Insights {
  topics: string[];
  relatedVerses: VerseWithRelevance[];
  possibleDirections: DirectionSuggestion[];
  thoughtsPlan?: ThoughtsPlan;
}

// СТАЛО:
export interface Insights {
  topics: string[];
  relatedVerses: VerseWithRelevance[];
  possibleDirections: DirectionSuggestion[];
  sectionHints?: SectionHints;
}
```

#### 3. API routes

**Файл:** `frontend/app/api/insights/plan/route.ts`

```typescript
// БЫЛО:
const thoughtsPlan = await generateThoughtsPlan(/* ... */);
return NextResponse.json({ thoughtsPlan });

// СТАЛО:
const sectionHints = await generateSectionHints(/* ... */);
return NextResponse.json({ sectionHints });
```

#### 4. OpenAI client

**Файл:** `frontend/app/api/clients/openAI.client.ts`

Найти функции генерации и переименовать:
```typescript
// БЫЛО:
export async function generateThoughtsPlan(/* ... */): Promise<ThoughtsPlan>

// СТАЛО:
export async function generateSectionHints(/* ... */): Promise<SectionHints>
```

#### 5. Компоненты

**Файл:** `frontend/app/components/sermon/KnowledgeSection.tsx`

```typescript
// БЫЛО:
const [thoughtsPlan, setThoughtsPlan] = useState<ThoughtsPlan | null>(null);

// СТАЛО:
const [sectionHints, setSectionHints] = useState<SectionHints | null>(null);
```

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Обновить Insights interface
- [ ] Обновить API routes
- [ ] Обновить OpenAI client
- [ ] Обновить компоненты
- [ ] Обновить тесты
- [ ] Запустить `npm test`
- [ ] Коммит: `git commit -m "refactor: rename ThoughtsPlan to SectionHints"`

---

## Задача 4: Outline → SermonOutline

**Приоритет:** 🟡 Важный  
**Сложность:** Средняя  
**Время:** 45-60 минут  

### Почему это переименование важно:
Добавление префикса `Sermon` для ясности и консистентности с другими сущностями.

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Outline {
  introduction: OutlinePoint[];
  main: OutlinePoint[];
  conclusion: OutlinePoint[];
}

// СТАЛО:
export interface SermonOutline {
  introduction: SermonPoint[];
  main: SermonPoint[];
  conclusion: SermonPoint[];
}
```

**ВНИМАНИЕ:** Одновременно переименовываем `OutlinePoint` → `SermonPoint`

#### 2. Использование в Sermon
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Sermon {
  // ...
  outline?: Outline;
}

// СТАЛО:
export interface Sermon {
  // ...
  outline?: SermonOutline;
}
```

#### 3. API routes

**Файл:** `frontend/app/api/sermons/outline/route.ts`

```typescript
// БЫЛО:
const outline: Outline = await getOutline(sermonId);

// СТАЛО:
const outline: SermonOutline = await getSermonOutline(sermonId);
```

#### 4. Компоненты

**Файл:** `frontend/app/components/sermon/SermonOutline.tsx`

```typescript
// БЫЛО:
interface SermonOutlineProps {
  outline: Outline;
}

// СТАЛО:
interface SermonOutlineProps {
  outline: SermonOutline;
}
```

**Файл:** `frontend/app/components/plan/OutlinePointCard.tsx`

Переименовать файл: `OutlinePointCard.tsx` → `SermonPointCard.tsx`

```typescript
// БЫЛО:
interface OutlinePointCardProps {
  point: OutlinePoint;
}

// СТАЛО:
interface SermonPointCardProps {
  point: SermonPoint;
}
```

#### 5. Hooks

**Файл:** `frontend/app/hooks/usePlan.ts`

```typescript
// БЫЛО:
const [outline, setOutline] = useState<Outline | null>(null);

// СТАЛО:
const [outline, setOutline] = useState<SermonOutline | null>(null);
```

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Обновить Sermon interface
- [ ] Обновить API routes
- [ ] Обновить все компоненты
- [ ] Переименовать файл OutlinePointCard
- [ ] Обновить все hooks
- [ ] Обновить тесты
- [ ] Запустить `npm test`
- [ ] Коммит: `git commit -m "refactor: rename Outline to SermonOutline and OutlinePoint to SermonPoint"`

---

## Задача 5: OutlinePoint → SermonPoint

**Приоритет:** 🟢 Желательный  
**Сложность:** Низкая  
**Время:** 20-30 минут  

### Почему это переименование важно:
Сокращение и консистентность с `SermonOutline`.

**ВНИМАНИЕ:** Это выполняется вместе с Задачей 4!

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface OutlinePoint {
  id: string;
  text: string;
  isReviewed?: boolean;
}

// СТАЛО:
export interface SermonPoint {
  id: string;
  text: string;
  isReviewed?: boolean;
}
```

#### 2. Все файлы, где используется

Поиск:
```bash
grep -r "OutlinePoint" frontend/ --include="*.tsx" --include="*.ts"
```

Заменить все вхождения на `SermonPoint`.

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Заменить все использования в коде
- [ ] Обновить тесты
- [ ] Запустить `npm test`
- [ ] (Коммит делается вместе с Задачей 4)

---

## Задача 6: Plan → SermonDraft

**Приоритет:** 🟡 Важный  
**Сложность:** Средняя  
**Время:** 45-60 минут  

### Почему это переименование важно:
`Plan` слишком общее. `SermonDraft` четко показывает: это черновик текста проповеди.

### Файлы для изменения:

#### 1. Определение интерфейса
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Plan {
  introduction: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  main: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  conclusion: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
}

// СТАЛО:
export interface SermonDraft {
  introduction: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  main: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  conclusion: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
}
```

#### 2. Использование в Sermon
**Файл:** `frontend/app/models/models.ts`

```typescript
// БЫЛО:
export interface Sermon {
  // ...
  plan?: Plan;
}

// СТАЛО:
export interface Sermon {
  // ...
  draft?: SermonDraft;
}
```

#### 3. API routes

**Файл:** `frontend/app/api/sermons/[id]/plan/route.ts`

Можно оставить путь `/plan` в URL (не ломать API), но изменить типы:

```typescript
// БЫЛО:
async function generateFullPlan(sermonId: string): Promise<Plan> {
  // ...
}

// СТАЛО:
async function generateFullSermonDraft(sermonId: string): Promise<SermonDraft> {
  // ...
}
```

#### 4. Hooks

**Файл:** `frontend/app/hooks/usePlan.ts`

```typescript
// БЫЛО:
const [plan, setPlan] = useState<Plan | null>(null);

// СТАЛО:
const [draft, setDraft] = useState<SermonDraft | null>(null);
```

#### 5. Компоненты

**Файл:** `frontend/app/components/plan/PlanSection.tsx`

```typescript
// БЫЛО:
interface PlanSectionProps {
  plan: Plan;
}

// СТАЛО:
interface PlanSectionProps {
  draft: SermonDraft;
}
```

**Файл:** `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx`

```typescript
// БЫЛО:
const { plan, loading, error } = usePlan(sermonId);

// СТАЛО:
const { draft, loading, error } = usePlan(sermonId);
```

### Чеклист выполнения:
- [ ] Обновить interface в `models.ts`
- [ ] Обновить Sermon interface
- [ ] Обновить API routes (типы, не URL)
- [ ] Обновить все hooks
- [ ] Обновить все компоненты
- [ ] Обновить тесты
- [ ] Запустить `npm test`
- [ ] Коммит: `git commit -m "refactor: rename Plan to SermonDraft"`

---

## 🔍 Полезные команды для поиска

### Найти все использования интерфейса:
```bash
# Для Structure:
grep -r "Structure" frontend/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"

# Для Item:
grep -r ": Item" frontend/ --include="*.tsx" --include="*.ts"

# Для Outline:
grep -r "Outline" frontend/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

### Найти импорты:
```bash
grep -r "import.*Structure" frontend/ --include="*.tsx" --include="*.ts"
```

### Проверить TypeScript после изменений:
```bash
cd frontend
npx tsc --noEmit
```

### Запустить тесты:
```bash
cd frontend
npm test
```

---

## ⚠️ Важные предупреждения

### 1. База данных (Firestore)
После переименования полей в интерфейсе Sermon, нужно будет:
- **Либо**: Обновить данные в Firestore (миграция)
- **Либо**: Добавить обратную совместимость при чтении

**Пример обратной совместимости:**
```typescript
const sermon = docSnap.data() as Sermon;

// Поддержка старого поля
if (!sermon.thoughtsBySection && sermon.structure) {
  sermon.thoughtsBySection = sermon.structure;
}
```

### 2. API эндпоинты
Если API используется извне (мобильное приложение, другие сервисы), не меняйте URL:
- Оставьте `/api/structure` → но внутри работайте с `ThoughtsBySection`
- Сделайте алиасы для совместимости

### 3. Git конфликты
При работе в команде:
- Предупредите коллег о большом рефакторинге
- Делайте это в отдельной ветке
- Мержите в период низкой активности

---

## ✅ Финальный чеклист

### Перед началом:
- [ ] Прочитал весь документ
- [ ] Создал ветку `refactor/rename-entities`
- [ ] Все тесты проходят
- [ ] Сделал backup или коммит

### Во время выполнения:
- [ ] Выполняю задачи по порядку
- [ ] После каждой задачи - запускаю тесты
- [ ] После каждой задачи - делаю коммит
- [ ] Проверяю TypeScript после каждого изменения

### После завершения:
- [ ] Все тесты проходят: `npm test`
- [ ] Нет TypeScript ошибок: `npx tsc --noEmit`
- [ ] Нет lint ошибок: `npm run lint`
- [ ] Приложение запускается без ошибок
- [ ] Проверил основные функции в браузере
- [ ] Создал Pull Request с описанием изменений
- [ ] Запросил code review

---

## 📊 Трекинг прогресса

Отмечайте выполненные задачи:

```
Прогресс: [==........] 20% (1 из 6)

✅ Задача 3: ThoughtsPlan → SectionHints
⬜ Задача 5: OutlinePoint → SermonPoint  
⬜ Задача 2: Item → ThoughtInStructure
⬜ Задача 6: Plan → SermonDraft
⬜ Задача 4: Outline → SermonOutline
⬜ Задача 1: Structure → ThoughtsBySection
```

---

## 🎓 Дополнительные ресурсы

### Статьи о рефакторинге:
- Martin Fowler - Refactoring: Improving the Design of Existing Code
- Michael Feathers - Working Effectively with Legacy Code

### TypeScript документация:
- https://www.typescriptlang.org/docs/handbook/2/everyday-types.html

---

**Удачи в рефакторинге! 🚀**

При возникновении вопросов или проблем - останавливайся и думай, не спеши.
Лучше потратить лишние 10 минут на проверку, чем час на исправление ошибок.

