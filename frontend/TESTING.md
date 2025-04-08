# Руководство по тестированию

## Организация тестов

В проекте используется следующая структура организации тестов:

1. **Корневая директория тестов** - `frontend/__tests__/` 
   - Содержит тесты для компонентов и утилит, которые не тесно связаны с конкретной функциональностью внутри директории `app/`
   - Поддерживает структуру, аналогичную структуре приложения (`components/`, `utils/`)

2. **Тесты внутри директорий модулей** - `app/**/\__tests__/`
   - Для тестов, которые тесно связаны с конкретными модулями внутри директории `app/`
   - Например: `app/utils/__tests__/exportContent.test.ts`

## Правила организации тестов

1. **Именование файлов:**
   - Файлы тестов должны иметь суффикс `.test.ts` или `.test.tsx`
   - Имя файла теста должно соответствовать имени тестируемого файла: `Component.tsx` → `Component.test.tsx`

2. **Размещение тестов:**
   - **Для компонентов UI:** поместите тесты в `__tests__/components/`
   - **Для утилит общего назначения:** поместите тесты в `__tests__/utils/`
   - **Для модуль-специфичных функций:** поместите тесты в `app/module/__tests__/`

3. **Организация тестового файла:**
   - Группируйте тесты с использованием блоков `describe`
   - Используйте вложенные блоки `describe` для группировки связанных тестов
   - Используйте говорящие имена тестов, описывающие ожидаемое поведение

## Запуск тестов

```bash
# Запуск всех тестов
npm test

# Запуск тестов только для компонентов
npm run test:components

# Запуск тестов только для утилит
npm run test:utils

# Запуск с генерацией отчёта о покрытии
npm run test:coverage
```

## Примеры

### Пример теста компонента

```tsx
// __tests__/components/MyComponent.test.tsx
import { render, screen } from '@testing-library/react';
import MyComponent from '@components/MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
  
  // Другие тесты...
});
```

### Пример теста утилит

```ts
// __tests__/utils/myUtil.test.ts
import { myFunction } from '@utils/myUtil';

describe('myFunction', () => {
  it('returns expected output for valid input', () => {
    expect(myFunction('input')).toBe('expected output');
  });
  
  it('throws error for invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
}); 