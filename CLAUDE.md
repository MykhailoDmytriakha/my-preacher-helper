IMPROTANT DO it ALWAYS on beggning: 
- READ, and FOLLOW instruction and ROLE from `AGENTS.md` file, from the root folder of the project.
- общайся с пользователем или на русском или на английском. НЕЛЬЗЯ на украинском.

## UX fixes — расширять scope до related problems, не лимитировать narrow запросом

Когда пользователь показывает один UX-баг, **активно искать связанные проблемы рядом** и фиксить их в том же проходе. Узкий запрос ("нет кнопки удалить") часто — лишь самый видимый случай **глобальной проблемы** ("UI не покрывает базовые операции с node'ой"). Один targeted fix без расширения оставляет рядом 2-3 параллельных бага той же природы — пользователь увидит их следующим тиком и спросит "почему ты не починил пока был там?".

**How to apply:**
- При получении конкретного UX-баг репорта — сначала **классифицировать root cause** (не симптом). "Header textarea отсутствует у пустой ноды" → root: "render gated на `hasHeader` — same gate скрывает header у text-only ноды и text у header-only ноды, и оба у media-only ноды".
- Перечислить все варианты с тем же root cause **до начала fix'а**. Решить общим патчем (например, в edit mode ВСЕГДА показывать оба textarea с placeholder'ами).
- Если есть видимые UX-нелогичности рядом (drag handle мелкий → touch target нарушение; tooltip отсутствует на кнопках; deletes без confirm; placeholder English в RU-app) — добавить к patch если они той же epistemic природы (всё про affordance discoverability / safety).
- В commit message явно перечислить **все related fixes**, не только запрошенный — пользователь увидит проактивность.

**Anti-pattern:** "fix exactly what был указан, остальное в next iteration" — пользователь это считывает как нежелание думать шире и говорит "ты не видишь глобальную рядом с существующей". Reactive narrow fix worse чем proactive scope expansion.

**Anchor:** 2026-05-20 node-based notes wave — user сначала указал "нет delete кнопки", потом "нет header field у empty ноды", потом "видишь рядом — фикси". Каждый раз был unifying root cause shared across 3-5 related cases.

## Сообщения пользователя посреди работы — простой decision tree

Когда приходит сообщение пока я выполняю задачу:

1. **Относится к текущей задаче?** → изменить выполнение текущей задачи и продолжить (записать как steering note).
2. **Не относится — это следующая задача.** Тогда:
   - **Не зависит от текущего кода** → запустить параллельно (Codex window или background agent), сам продолжаю основную задачу.
   - **Затрагивает текущий код** → добавить в TaskList и выполнить **последовательно** после текущей (нельзя параллельно — конфликт правок).

Всё. Не нужно угадывать что "orthogonal" а что "steering" — это про границу "тот же код / другой код". И не нужно прерывать текущую — только переориентировать её или ждать.

**Anchor:** 2026-05-20 node-based notes wave — пока я делал preview modal, пользователь бросил "проверь логику сохранения" (другой компонент, но в том же файле page.tsx → последовательно, в TaskList). А wikilink chip restyle ("сделай зеленым, как Android chip") был про текущую задачу wikilink → применил сразу.

## Понимаю на 100% — делаю. Сомневаюсь — спрашиваю.

Простое правило перед действием по запросу пользователя: если я **на 100% понимаю что он хочет** (что менять, где, как должно выглядеть/работать) — делаю молча. Если есть **хотя бы одна неоднозначность** ("перенести или дополнить?", "вместо или сверху?", "какой стиль?", "это про X или Y?") — спрашиваю **одним коротким вопросом** через AskUserQuestion (или text), не угадываю.

Лучше спросить и подождать 5 секунд, чем сделать не то и потом переделывать — пользователь предпочитает точность скорости-наугад.

**Anti-pattern:** "сделаю как мне кажется правильно, потом он скажет если не то" — нет, не скажет аккуратно: скажет "ты упустил" / "ты опять не так". Каждое "не так" разрушает доверие к realtime-collaboration сильнее чем clarification-вопрос.

**Anchor:** 2026-05-20 — пользователь явно попросил это записать после того как я несколько раз делал угадывая, и каждый раз приходилось переделывать.

## 🚧 ACTIVE BIG MIGRATION — Firestore client-SDK "local-first" (since 2026-06-07)
We are migrating data access from "browser → our API routes (Firebase Admin SDK)" to the
**client Firestore SDK with offline persistence + Security Rules** (decided: **Variant B**).
Backend stays ONLY for secrets (AI) and cross-user sharing. Multi-session, strangler-fig
(switch one collection at a time, base always green).

**Plan + live progress + decisions + Next Steps live in ONE master journal:**
👉 `.sessions/SESSION_2026-06-07-firestore-client-migration.md`

At the start of ANY migration work: read that journal → see `## Current State` → do `## Next Steps`
→ append to `## Progress Log` (never delete old entries). Do not create a new migration file.
