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