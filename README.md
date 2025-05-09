# MVP: AI-Помощник для Проповедников

## 🔗 **Ссылка на приложение**

<https://my-preacher-helper.vercel.app/>

## 🔗 **Что это за приложение и зачем оно нужно?**

Когда проповедник начинает готовиться, у него есть тема или текст, на который он ориентируется. Однако редко получается сразу структурировать всю проповедь. Сначала приходят отдельные **мысли** – «о, классная мысль, хорошая идея!» – но через пару часов они могут забыться.

Это приложение создано, чтобы **фиксировать и собирать** такие **драгоценные идеи**, которые приходят в процессе размышления. Приложение помогает:

- **Записывать мысли** по мере их появления.
- **Сортировать их по тегам** (вступление, основная часть, заключение).
- **Выявлять пробелы в подготовке**: если вступление перегружено мыслями, а основная часть пустая — это видно сразу.
- **Структурировать размышления в логичный поток** для формирования целостной проповеди.

Вместо хаотичных заметок и потери идей, проповедник получает **удобную систему для сбора, анализа и подготовки проповеди**.

---

## 🔗 **Цель MVP**

Создать минимально жизнеспособный продукт, который помогает проповедникам быстро записывать мысли, преобразовывать голос в текст, автоматически улучшать его и группировать по тегам для удобного использования.

---

## 🔄 **Основной флоу пользователя**

1. **Авторизация** через Google (Firebase Auth).
2. **Запись голоса** 🎧 (Whisper API переводит в текст).
3. **AI-обработка текста** (GPT улучшает текст, убирает шум, делает логичнее).
4. **Авто-тегирование** (GPT определяет: вступление, основная часть, завершение).
5. **Просмотр результата** (сгруппированные мысли по тегам).
6. **Экспорт** в **TXT, PDF, Word**.
7. **Dashboard** показывает текущие проповеди
   - здесь можно добавить в верху справа круглую иконку пользователя, и если пользователь гость, то предлагать перейти на постояннный гугл аккаунт

---

## 🔧 **Техническая реализация**

### **💻 Backend: Firebase + OpenAI**

- **Firebase Auth** → Вход через Google.
- **Firestore** → Храним расшифрованные и обработанные тексты.
- **Whisper API (или Google Speech-to-Text)** → Распознавание голоса.
- **GPT API** →
  - Улучшает текст (делает чище, убирает лишние слова).
  - Определяет структуру текста и расставляет теги.

### **🛠️ Frontend: Next.js + Tailwind UI**

- Кнопка **"Записать голос"**.
- Поле **"Готовый текст"** (улучшенный AI-текст).
- Автоматическая разметка по тегам.
- Кнопки **"Экспорт в TXT / PDF / Word"**.
- Гостевой режим с конвертацией в полноценный профиль
- Сохранение заметок в облаке, и стуктурирование проповеди
- expiration time (5 days) for guest mode to propagate user to use Google profile

---

## 🔄 **Разработка MVP (1 неделя)**

| День | Задача |
|------|--------|
| ~~**Step 1**~~ | ~~Настроить Next.js, Firebase, Google Login~~ ✅ |
| ~~**Step 2**~~ | ~~Реализовать запись аудио и передачу в Whisper API~~ ✅ |
| ~~**Step 3**~~ | ~~Подключить Whisper API, добавить транскрипцию~~ ✅ |
| ~~**Step 4**~~ | ~~Подключить GPT API, реализовать улучшение текста и авто-тегирование~~ ✅ |
| **Step 5** | Отображение данных + экспорт (TXT, PDF, Word) |
| ~~**Step 6**~~ | ~~Тестирование, исправление багов~~ ✅ |
| ~~**Step 7**~~ | ~~Финальная проверка и демо~~ ✅ |

---

## 🌟 **Ключевые особенности, которые обеспечат полезность за 30 минут**

- **Быстрый вход** → Авторизация в 1 клик.
- **Минимум кликов** → Просто записать голос, получить улучшенный текст.
- **Авто-тегирование** → Всё сразу структурировано.
- **Экспорт** → Готовый текст можно забрать в разных форматах.
- **Мгновенная обработка аудио** без хранения файлов.

---

### 💡 **Что дальше (версия 2.0)?**

- **Более умная обработка AI (улучшение стиля, анализ структуры)**.
- **Автоматическое подстраивание текста под определённые шаблоны проповедей**.
- **Глубокая интеграция с Библией (поиск цитат, иллюстраций и примеров).**
- **Аналитика (статистика, рекомендации по улучшению проповеди).**

---

### TODO

Export:

- export to pdf and word

Guest mode:

- Неавтоматизированный гостевой режим:
  Есть риск, что в Firebase будут бесконечно накапливаться данные от гостевых пользователей. Нужно либо явно пояснить, что данные гостя удаляются (и реализовать auto-cleanup), либо стимулировать пользователя конвертироваться в постоянного (Google) пользователя.
- Улучшение логики гостевого режима
  Что сделать:
  - Добавить баннер: «Вы вошли как гость, ваши данные будут храниться 5 дней» и кнопку «Привязать к Google-аккаунту».
  - Реализовать Firebase Cloud Function/cron-задачу для автоудаления гостевых данных, которым более 5 дней.
  - Ожидаемый результат: Более прозрачная политика хранения, уменьшение «мусорных» данных в Firestore.

Transciption:

- елси произошла ошибка при записи то нужно вернуть текст пользователю, если это возмножно
- плывет layout на маленьких эранах (мобильное приложение)

Logs:

- fix logging for AI

Offline:

- support offline mode using IndexDB
  To enable offline functionality in your preacher helper application:

  ### Core Strategy

  1. **Local Storage for Sermon Data**: Store complete sermon objects in browser's localStorage to make them available offline.

  2. **Online/Offline Detection**: Monitor network status to switch between online and offline modes automatically.

  3. **Change Tracking**: Keep track of changes made while offline in a queue to be synchronized later.

  4. **Synchronization Process**: When connection is restored, sync local changes with the server.

  ### Implementation Essentials

  1. **Local Storage Service**:

    - Functions to save/retrieve sermons locally
    - Track changes made while offline

  2. **Network Status Management**:

    - Detect when users go offline/online
    - Trigger synchronization when reconnected 

  3. **Modified API Services**:

    - Try online API first when connected
    - Fall back to local data when offline
    - Update local storage when online operations succeed

  4. **User Interface Updates**:
  
    - Indicator showing offline status
    - Clear feedback about synchronization status

  This approach provides a seamless experience where users can continue working with their sermons regardless of connection status. All changes made offline will automatically synchronize when they reconnect to the internet, without requiring manual intervention.
