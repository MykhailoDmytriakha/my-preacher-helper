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

### Phase 5 cleanup — 5.1–5.4 DONE; one sec-gap remains
Migration data path is live in prod (8/8 collections on client SDK).
- ✅ 5.1 (2026-06-24) Dead server routes removed (9 route files + plan-templates repo); 12 services made client-only for DEAD ops. KEEP (cascades/AI/share/embedded/intentional-create) untouched.
- ✅ 5.2 (2026-06-24) Backend now only AI + public sharing + cross-collection cascades + embedded + intentional create.
- ✅ 5.3 (2026-06-09, `4052c4dd`) SW "update available" toast + cache versioning (swRevision=git-SHA). RSC version-skew: not observed, low priority.
- ✅ 5.4 (2026-06-09) Offline ID-token expiry >1h: graceful by construction (see journal + [[project_offline_auth_graceful]]).
- ⏳ **REMAINING:** sec-gap — shareLinks ownership check on noteId before relying on rules.
NB: 5.1 burned the flag-flip rollback for migrated collections (dead routes + `else fetch()` branches deleted) — rollback is now `git revert`, not an env-flag flip. The `NEXT_PUBLIC_USE_CLIENT_*` Vercel flags are now no-ops (no code reads them) — safe to delete from Vercel later.
(Mechanism A/C already removed. No zombie flags. dev-only `.spike/` + `app/dev/` are gitignored.)