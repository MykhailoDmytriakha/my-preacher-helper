IMPROTANT DO it ALWAYS on beggning: 
- READ, and FOLLOW instruction and ROLE from `AGENTS.md` file, from the root folder of the project.
- общайся с пользователем или на русском или на английском. НЕЛЬЗЯ на украинском.

## 🚧 ACTIVE BIG MIGRATION — Firestore client-SDK "local-first" (since 2026-06-07)
We are migrating data access from "browser → our API routes (Firebase Admin SDK)" to the
**client Firestore SDK with offline persistence + Security Rules** (decided: **Variant B**).
Backend stays ONLY for secrets (AI) and cross-user sharing. Multi-session, strangler-fig
(switch one collection at a time, base always green).

**Plan + live progress + decisions + Next Steps live in ONE master journal:**
👉 `.sessions/SESSION_2026-06-07-firestore-client-migration.md`

At the start of ANY migration work: read that journal → see `## Current State` → do `## Next Steps`
→ append to `## Progress Log` (never delete old entries). Do not create a new migration file.