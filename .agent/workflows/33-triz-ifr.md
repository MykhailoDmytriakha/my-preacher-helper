---
name: 33-triz-ifr
description: Apply TRIZ + IFR (Ideal Final Result) thinking to resolve UX/architectural contradictions. Use when the user says "TRIZ+IFR подумай", "обсудим варианты", or when there are competing design approaches with no obvious winner.
---

# TRIZ + IFR: Architectural Decision Framework

Use to transform UX/architectural contradictions into elegant solutions by defining what the ideal system would do automatically, then deriving the minimal implementation to achieve it.

---

## When to Activate

- User says **"TRIZ+IFR подумай"** or **"давай обсудим"** before implementation
- Multiple valid approaches exist and no obvious winner
- A feature feels overengineered or underengineered
- Something "doesn't feel right" UX-wise but the cause isn't clear

---

## Process (3 Steps)

### Step 1: Name the Contradiction

State the tension explicitly:

```
Проблема: [что есть сейчас — недостаток]
vs.
Требование: [что должно быть — идеал]
```

### Step 2: Define IFR (Идеальный Конечный Результат)

Ask: **"Что идеальная система делает сама, без конфигурации и без условий?"**

The IFR removes the contradiction by describing the outcome as if the system is perfect. Write it in one sentence starting with "Идеальная система..."

### Step 3: Derive Minimal Solution

Starting from IFR, work backwards to find the smallest implementation that achieves it. Ask:
- What state change is needed?
- Which component owns this state?
- Can existing structure carry it, or does something new need to exist?

---

## Real Examples (from this project)

### Example 1 — Timer visibility
**Противоречие:**
Таймер молчит когда нет длительностей → бесполезен.
Таймер требует конфигурации → лишнее трение.

**IFR:**
Идеальная система всегда показывает полезную временну́ю информацию без конфигурации.

**Решение:** Три независимых слоя:
1. **Elapsed** (всегда) — счётчик вверх, серый — нет конфигурации
2. **Countdown** (если `durationMin`) — отсчёт вниз → amber → red overtime
3. **Global** (если `totalMeetingMin` в preflight) — `⏱ MM:SS` в хедере

---

### Example 2 — Overview: peek vs. complete
**Противоречие:**
Одна кнопка "≡ Overview" нужна и для промежуточного просмотра, и для завершения.
Но промежуточный просмотр ≠ завершение.

**IFR:**
Идеальная система автоматически знает разницу между "посмотреть" и "завершить" без явного выбора пользователем.

**Решение:** Два семантически разных пути:
- `onPeek()` — кнопка "≡" в любом блоке → таймер на паузу, `currentIndex` не меняется, блок остаётся "→" синим
- `onCompleteAll()` — кнопка "Overview →" на **последнем** блоке → `currentIndex = flow.length` (sentinel), все ✓ зелёные

```
currentIndex < flow.length  → mid-meeting peek
currentIndex >= flow.length → all completed
```

---

### Example 3 — Timer persistence across peek
**Противоречие:**
`key={flowItem.id}` на компоненте сбрасывает таймер при ремаунте.
Но нужно, чтобы время накапливалось — peek не должен обнулять счётчик.

**IFR:**
Идеальная система накапливает реальное время блока независимо от навигации.

**Решение:** Три элемента:
1. `blockTimes: Record<string, number>` в `page.tsx` — хранит накопленное время per block
2. `onTimeRecorded(id, elapsed)` callback — вызывается при любой навигации (`navigate()` helper)
3. `initialElapsed` параметр в `useConductTimer` — стартует с сохранённого значения

При peek: `setIsPaused(true)` → таймер замирает.
При возврате: `setIsPaused(false)` + `initialElapsed={blockTimes[id] ?? 0}` → продолжает с сохранённого.

---

## Output Format

When presenting TRIZ+IFR analysis to the user:

```
**Противоречие:** [в одну фразу]
**IFR:** Идеальная система [делает X] без [Y условия].
**Решение:** [минимальная реализация]
```

Предложи 2–3 варианта только если противоречие допускает несколько IFR.
Дождись подтверждения ("да") перед реализацией.

---

## Anti-patterns

- ❌ Начинать реализацию до формулировки IFR
- ❌ IFR типа "система делает X если пользователь настроит Y" — это не IFR
- ❌ Несколько противоречий в одном IFR — разбить на отдельные
- ❌ Слишком общий IFR ("всё работает хорошо") — добавить конкретное ограничение
