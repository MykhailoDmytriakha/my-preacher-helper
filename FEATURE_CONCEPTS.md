# Новые фичи Dashboard - Концептуальный документ

## Обзор
Этот документ содержит подробные концепции для новых фич Dashboard, которые улучшат пользовательский опыт работы с проповедями.


## 1. Поиск по содержимому мыслей

### Описание фичи
Расширение поиска проповедей с возможностью поиска не только по заголовку и стиху, но и по содержимому всех мыслей проповеди.

### Пользовательская ценность
- **Глубокий поиск**: Найти проповедь по ключевой фразе из любой мысли
- **Восстановление памяти**: "Я помню, что говорил что-то про 'любовь к ближнему', но не помню в какой проповеди"
- **Эффективность**: Не нужно открывать каждую проповедь для поиска

### Технические требования

#### Поисковый индекс
```typescript
interface SearchIndex {
  sermonId: string;
  title: string;           // Уже индексируется
  verse: string;          // Уже индексируется
  thoughts: string[];     // Новое: массив текстов мыслей
  tags: string[];         // Новое: все теги проповеди
  searchText: string;     // Новое: комбинированный текст для полнотекстового поиска
}
```

#### Поисковая логика
```typescript
// Сервис поиска
class SermonSearchService {
  async search(query: string, options: SearchOptions): Promise<Sermon[]> {
    const results = await this.fullTextSearch(query, {
      fields: ['title', 'verse', 'thoughts', 'tags'],
      fuzzy: options.fuzzy,
      highlight: options.highlight
    });

    return this.rankAndSort(results, query);
  }
}
```

#### Опции поиска
```typescript
interface SearchOptions {
  fuzzy?: boolean;        // Неточный поиск
  highlight?: boolean;    // Подсветка найденных фрагментов
  limit?: number;         // Максимум результатов
  sortBy?: 'relevance' | 'date' | 'title';
}
```

### UI/UX концепции

#### Интерфейс поиска
```typescript
// Расширенное поле поиска
<SearchInput
  placeholder="Поиск по заголовку, стиху, мыслям..."
  value={searchQuery}
  onChange={setSearchQuery}
  showAdvanced={showAdvancedSearch}
  onToggleAdvanced={() => setShowAdvancedSearch(!showAdvancedSearch)}
/>

// Расширенные опции
<AdvancedSearchOptions>
  <Checkbox label="Поиск в мыслях" checked={searchInThoughts} />
  <Checkbox label="Поиск в тегах" checked={searchInTags} />
  <Checkbox label="Нечеткий поиск" checked={fuzzySearch} />
</AdvancedSearchOptions>
```

#### Результаты поиска
- **Подсветка**: Найденные фрагменты выделены желтым
- **Превью**: Показывать контекст найденной фразы
- **Группировка**: Группировать результаты по релевантности

#### Адаптивность
- **Desktop**: Расширенные опции в дропдауне
- **Mobile**: Упрощенный интерфейс, опции в отдельном модальном окне

### Интеграция с существующей системой

#### Firebase поиск
```typescript
// Использование Firestore compound queries
const searchResults = await db.collection('sermons')
  .where('userId', '==', userId)
  .where('searchText', '>=', query)
  .where('searchText', '<=', query + '\uf8ff')
  .limit(50)
  .get();
```

#### Кеширование
```typescript
// Локальный кеш для быстрого поиска
const searchCache = new Map<string, Sermon[]>();

const getCachedResults = (query: string) => {
  return searchCache.get(normalizeQuery(query));
};
```

### Edge cases
1. **Длинные мысли**: Ограничить длину индексированного текста (max 1000 символов на мысль)
2. **Спецсимволы**: Нормализовать поисковый запрос (удалить пунктуацию, lowercase)
3. **Много результатов**: Пагинация и "Показать еще"
4. **Пустой поиск**: Показать подсказки по популярным запросам

### Метрики успеха
- **Использование**: % поисковых запросов, включающих контент мыслей
- **Эффективность**: Среднее время нахождения нужной проповеди
- **Удовлетворенность**: Уменьшение количества "не нашел" инцидентов

---

## 3. Календарь проповедей

### Описание фичи
Добавление календаря для отслеживания дат, когда каждая проповедь была прочитана. Поддержка множественных дат для одной проповеди.

### Пользовательская ценность
- **Исторический трекинг**: Видеть, когда и как часто проповедь использовалась
- **Планирование**: Избегать повторения одних и тех же проповедей слишком часто
- **Аналитика**: Понимать паттерны использования проповедей
- **Воспоминания**: "Это была проповедь на Рождество 2023"

### Технические требования

#### Модель данных
```typescript
interface Sermon {
  // ... существующие поля
  preachDates?: PreachDate[]; // Новое поле
}

interface PreachDate {
  id: string;
  date: string;           // ISO date string
  location?: string;      // Место проведения (опционально)
  audience?: string;      // Аудитория (опционально)
  notes?: string;         // Заметки о проведении
  createdAt: string;      // Когда была добавлена дата
}
```

#### API endpoints
```typescript
// Новые эндпоинты
POST /api/sermons/:id/preach-dates    // Добавить дату
PUT /api/sermons/:id/preach-dates/:dateId  // Обновить дату
DELETE /api/sermons/:id/preach-dates/:dateId // Удалить дату
GET /api/sermons/:id/preach-dates     // Получить все даты проповеди
```

### UI/UX концепции

#### Календарь Dashboard
```typescript
// Компонент календаря
<PreachCalendar
  sermons={sermons}
  selectedDate={selectedDate}
  onDateSelect={handleDateSelect}
  viewMode="month" // month, week, agenda
/>

// Индикаторы на календаре
<div className="calendar-day">
  <span className="day-number">15</span>
  {hasSermons && <div className="sermon-indicator" />} // Точка если есть проповеди
</div>
```

#### Управление датами проповедей
```typescript
// В карточке проповеди
<PreachDateManager
  sermon={sermon}
  onAddDate={(date) => addPreachDate(sermon.id, date)}
  onUpdateDate={(dateId, updates) => updatePreachDate(sermon.id, dateId, updates)}
  onRemoveDate={(dateId) => removePreachDate(sermon.id, dateId)}
/>

// Модальное окно добавления даты
<AddPreachDateModal
  sermon={sermon}
  onSave={handleSaveDate}
  initialDate={today}
/>
```

#### Визуальный дизайн
- **Календарь**: Compact календарь с точками-индикаторами
- **Цвета**: Разные цвета для разных типов проповедей
- **Hover**: Показывать превью проповедей при наведении
- **Множественные даты**: Badge с количеством проведений

### Интеграция с существующей системой

#### Firebase структура
```typescript
// Subcollection для дат проповедей
/sermons/{sermonId}/preachDates/{dateId}

interface PreachDateDoc {
  date: string;
  location?: string;
  audience?: string;
  notes?: string;
  createdAt: string;
  // Автоматически добавляемые поля
  userId: string; // Для security rules
}
```

#### Синхронизация
```typescript
// Синхронизация с существующими данными
const migrateExistingPreachedStatus = async () => {
  const sermons = await getSermons(userId);
  for (const sermon of sermons) {
    if (sermon.isPreached && !sermon.preachDates?.length) {
      // Добавить дату на основе даты создания или последней модификации
      await addPreachDate(sermon.id, {
        date: sermon.date, // или другой подходящей датой
        notes: 'Migrated from isPreached flag'
      });
    }
  }
};
```

### Edge cases
1. **Множественные проведения**: Одна проповедь может иметь много дат
2. **Будущие даты**: Возможность планировать будущие проповеди
3. **Импорт данных**: Миграция существующих данных о проведенных проповедях
4. **Удаление**: Каскадное удаление дат при удалении проповеди

### Метрики успеха
- **Использование**: % проповедей с хотя бы одной датой проведения
- **Активность**: Среднее количество дат на проповедь
- **Планирование**: % проповедей с запланированными будущими датами

---

## 4. Аналитика качества проповедей

### Описание фичи
Система аналитики, которая анализирует соотношение количества мыслей к качеству финального результата проповеди.

### Пользовательская ценность
- **Самосовершенствование**: Понимать, сколько усилий приводит к хорошему результату
- **Эффективность**: Оптимизировать процесс подготовки
- **Мотивация**: Видеть прогресс в качестве проповедей со временем
- **Обучение**: Лучше понимать, что влияет на качество

### Технические требования

#### Метрики качества
```typescript
interface SermonQualityMetrics {
  thoughtCount: number;           // Количество мыслей
  structureCompleteness: number;  // 0-100% заполненности структуры
  planCompleteness: number;       // 0-100% готовности плана
  tagConsistency: number;         // 0-100% консистентности тегов
  averageThoughtLength: number;   // Средняя длина мысли
  uniqueTagsCount: number;        // Количество уникальных тегов
  hasPlan: boolean;               // Наличие плана
  prepTime?: number;              // Время подготовки (если отслеживается)
}

// Общий скор качества
interface QualityScore {
  overall: number;        // 0-100
  breakdown: {
    content: number;      // Качество контента
    structure: number;    // Качество структуры
    completeness: number; // Завершенность
  };
  insights: string[];     // Рекомендации по улучшению
}
```

#### Алгоритм расчета качества
```typescript
const calculateQualityScore = (sermon: Sermon): QualityScore => {
  const metrics = extractMetrics(sermon);

  const contentScore = calculateContentScore(metrics);
  const structureScore = calculateStructureScore(metrics);
  const completenessScore = calculateCompletenessScore(metrics);

  const overall = (contentScore + structureScore + completenessScore) / 3;

  return {
    overall: Math.round(overall),
    breakdown: { contentScore, structureScore, completenessScore },
    insights: generateInsights(metrics, overall)
  };
};
```

### UI/UX концепции

#### Качественный дашборд
```typescript
// Виджет качества на Dashboard
<QualityAnalyticsWidget
  sermons={sermons}
  timeRange="last30days"
  onTimeRangeChange={setTimeRange}
/>

// Карточка с метриками качества
<QualityCard
  title="Эффективность подготовки"
  score={85}
  trend="+5%"
  insights={[
    "Качество растет с количеством мыслей до 25-30",
    "Структурированные проповеди получают на 20% выше оценку"
  ]}
/>
```

#### Детальная аналитика
```typescript
// Страница детальной аналитики
<QualityAnalyticsPage>
  <QualityChart data={qualityData} />
  <InsightsPanel insights={personalizedInsights} />
  <RecommendationsPanel recommendations={aiRecommendations} />
</QualityAnalyticsPage>
```

#### Визуализация
- **Графики**: Количество мыслей vs качество (scatter plot)
- **Тренды**: Изменение качества со временем
- **Распределение**: Гистограмма оценок качества
- **Сравнение**: Сравнение с "идеальными" проповедями

### Интеграция с существующей системой

#### Хранение данных
```typescript
// Автоматический расчет при изменениях
useEffect(() => {
  const qualityScore = calculateQualityScore(sermon);
  updateSermonQuality(sermon.id, qualityScore);
}, [sermon.thoughts, sermon.structure, sermon.plan]);
```

#### AI insights
```typescript
// Генерация рекомендаций через AI
const generateQualityInsights = async (metrics: SermonQualityMetrics): Promise<string[]> => {
  const prompt = `Analyze sermon quality metrics and provide 3 specific recommendations for improvement...`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  });

  return parseInsights(response.choices[0].message.content);
};
```

### Edge cases
1. **Новые проповеди**: Недостаточно данных для анализа качества
2. **Разные стили**: Качество субъективно для разных типов проповедей
3. **Незавершенные проповеди**: Не включать в статистику качества
4. **Крайние значения**: Обработка выбросов в данных

### Метрики успеха
- **Использование**: % пользователей, просматривающих аналитику качества
- **Вовлеченность**: Время, проведенное на странице аналитики
- **Улучшение**: Рост среднего качества проповедей со временем
- **Retention**: Удержание пользователей, использующих аналитику

---

## Заключение

Эти четыре фичи значительно улучшат пользовательский опыт работы с Dashboard:

1. **Быстрый доступ к плану** - повысит эффективность работы с подготовленными проповедями
2. **Глубокий поиск** - улучшит находимость контента
3. **Календарь проповедей** - добавит исторический контекст и поможет в планировании
4. **Аналитика качества** - поможет пользователям совершенствоваться

Каждая фича имеет четкие технические требования, UI концепции и метрики успеха. Все фичи интегрируются с существующей архитектурой без breaking changes.
