# Новые фичи Dashboard - Концептуальный документ

## Обзор
Этот документ содержит подробные концепции для новых фич Dashboard, которые улучшат пользовательский опыт работы с проповедями.

## 0. Ideas
- нужно доавить возможность использовать платные модели, потому что бесплатные могут быстро закончиться
- ПРоблема: редактирование заметки в mobile view
- иногдапользователь создает огромную `Thought` и в нее ложит все свои наработки и идеи для будущей проповеди, вообще нужна возможно, если к заметки добавить определенный тэг, то у нее появляется опция конвертироватьв в проповедь, на основе заметки создается план проповеди (структура), и мысли. И тоже самое можно сделать с заметкамиа, когда из заметки создается план проповеди (структура), и мысли.

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
