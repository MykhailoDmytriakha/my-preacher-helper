# Firestore cross-device sync — research & converged design

> **Status:** research / design understanding. NOT yet implemented. No code changed by this study.
> **Method:** Popper loop — proposal (Claude) → open-mandate adversarial refutation (Codex `gpt-5.6-sol`, high effort, free to find its own failure modes) → convergence. Date: 2026-07-19.
> **Companion notes:** `FEATURE_CONCEPTS.md` (earlier iterations), memory `project_nuqs_search_clear_flicker.md` is unrelated.

---

## 0. The goal (business/UX, not a solution)

A user edits their data on phone **and** desktop. Today an edit on one device does not appear on the other until manual refresh or navigation — and a real **two-device overwrite/desync** has already happened. We want:

1. A device **knows** when its displayed data is not current.
2. It **reconciles before editing**.
3. Concurrent edits are **not silently overwritten**.
4. It fits **safely under the Spark (free) tier**: 50,000 reads/day, 20,000 writes/day, resets ~midnight PT, app is **blocked (not billed)** when exceeded. Scale ~100 users/month (~15–30 DAU).

App shape: personal sermon-prep tool, mostly **single-user per account**, **low write frequency**, opened a few times/day, **not** live-collab.

---

## 1. How data actually flows today (corrected by reading the code)

```
Page → domain hook → useServerFirstQuery
   → React Query memory / persisted snapshot
   → only if custom isOnline==true: service getDocs/getDoc
        → Firestore IndexedDB cache → Firestore backend
   → React Query cache → React Query IndexedDB persister
```

- Firestore client has **built-in persistent IndexedDB cache, multi-tab** ON — `firebaseClientDb.ts:28-36`. It holds cached docs, native pending writes, **query target metadata + resume tokens**, multi-tab data.
- Reads are **one-shot `getDocs`/`getDoc`**, **no `onSnapshot` anywhere**. Corrected inventory: **10** collection-query `getDocs` sites (not "~21"), **23** `getDoc`, ~18 `useServerFirstQuery` consumers.
- React Query adds a **second IndexedDB store** (`queryPersister.ts:7-26`, global key `react-query-cache`; `QueryProvider.tsx:79-93`).
- Freshness defaults: `staleTime 30s`, `refetchOnWindowFocus:false`, `refetchOnReconnect:true`, `refetchOnMount:true`, `networkMode offlineFirst` (`QueryProvider.tsx:50-68`, `useServerFirstQuery.ts:54-65`). → another device's change never invalidates this device until mount/nav/reconnect/manual refresh. **This is the observed staleness.**

**Non-obvious facts the study surfaced (matter for any fix):**
- **Offline rendering comes from the React Query persister, NOT Firestore's cache** — because `useServerFirstQuery` disables its `queryFn` when the *custom* online detector says offline (`useServerFirstQuery.ts:51-65`). → **Removing React Query persistence would break offline startup.** (This kills the earlier "drop the double cache" idea.)
- The **custom online detector is app-API-based**, not Firestore connectivity: any unrelated API timeout / `Failed to fetch` marks the whole app offline (`apiClient.ts:95-110`) with a 3s recovery hysteresis → **can suppress valid Firestore reads even when Firestore is reachable.**
- **Detail cache is seeded from list cache** and inherits the list's `dataUpdatedAt` (`useSermon.ts:43-68`) → a stale-but-"fresh-for-30s" list suppresses a detail fetch.
- The **structure editor deliberately avoids invalidation** because a background refetch previously **overwrote unsaved edits** (`useSermonStructureData.ts:242-264`). → **Piping listener snapshots blindly into React Query would reproduce the overwrite.** Incoming data needs a **reconciliation policy**, not `setQueryData(snapshot)`.
- **Two write queues:** Firestore native queue (direct SDK writes) + React Query paused/error mutations (some ops are still server API calls: sermon create/delete `sermon.service.ts:21-62`, prayer create `prayerRequests.service.ts:63-78`).
- **Security/isolation latent risk:** the React Query persister is **global and not cleared on logout** (`useAuth.ts:39-55`); some keys omit UID (`useSermon.ts:58-68`). Firestore rules block *backend* reads, but do not erase previously persisted React Query data → stale cross-account data on a shared browser.

---

## 2. Is realtime even warranted?

- **Global realtime: NO.** Not Google-Docs; single-user, low-write, few sessions/day; quota matters more than sub-second latency.
- **Active-route freshness: YES** — because stale state is no longer cosmetic: it becomes an **input to a later write** (the overwrite bug). Focus-only refresh alone fails when: desktop stays foreground during a phone edit; PWA resume without a clean focus event; the custom API detector suppresses reads; editing begins during the refetch; the refetch races an autosave.
- Contract to aim for: **"fresh before editing and quickly updated while the route is active,"** not "every collection listened to forever."

---

## 3. Firestore SDK facts (v11.2.0 / @firebase/firestore 4.7.6), verified

- **Cache-only reads/listeners are NOT billed** (no server contact). `source:'cache'` avoids server reads. A default listener may emit cached first, then reconcile with server (billed).
- `fromCache:true` = possibly stale/incomplete; `fromCache:false` = server-current; `hasPendingWrites` = local latency-compensated write.
- **Listener billing:** initial result docs = reads; each added/updated matching doc = read; removal-because-changed = read; **deletion itself is not** a listener read; empty query = min 1 read.
- **30-minute rule:** with persistence, a reconnect after >30 min offline is billed **as a brand-new query**; without persistence, **every** reconnect is.
- **Resume token across detach/reattach & reload — CONDITIONAL, not magic.** SDK internals: `getDocs()` itself runs via a short-lived listener; the SDK can reuse persisted target metadata + resume token for an **identical canonical query**, and target metadata survives release (LRU, not deleted immediately). BUT the **public docs do not promise delta billing for repeated one-shot queries** — budget every one-shot query as a **full** returned result until a billing experiment proves otherwise.
- **What forces a full reread:** first visit / cleared / evicted IndexedDB; private mode; >30-min disconnect; changed target shape (filter/order/limit/UID/converter); LRU GC of target metadata; storage eviction / "clear site data"; **existence-filter mismatch → hard reset (token cleared)**; listener permission failure (listener stops); internal listen→poll fallback; app-version/schema change altering the canonical query.

**Conclusion on the earlier proposal:** directionally right (listeners + resume token make long-lived listeners efficient) but **too confident** — do **not** treat resume tokens as a cost shield around frequent detach/reattach.

---

## 4. Design space (Codex-enumerated, 15 candidates)

Let N = docs returned by the active route's queries; q = #queries; F = focus/reconnect refreshes; P = poll cycles; C = changed docs while active; Nd = docs in one affected domain. Illustrative session: dashboard N=300, q=5, 20-min, F=2, P=4 (5-min poll), C=1, Nd=60. Costs = conservative server-read estimates.

| # | Mechanism | Typical reads | Where it breaks |
|---|---|---:|---|
| 1 | Nothing (today) | 0 while stale / N on fetch | **Already falsified** — edit stale → overwrite newer |
| 2 | Explicit refresh + good status UI | ~600 | Human discipline as the protocol; deletes/remote changes invisible until acted |
| 3 | Refetch on focus/reconnect (throttled) | ~900 | Misses foreground↔foreground edits; PWA lifecycle; custom detector can suppress |
| 4 | Fixed polling on active page | ~1,500 | Background throttling, rereads unchanged, 20 DAU can exceed Spark |
| 5 | `updatedAt > lastSeen` delta query | ~301 | Clock skew, equal ts, **deletes invisible**, some writes don't bump `updatedAt` (`sermons.client.ts:193-205`) |
| 6 | **Short-lived listener, detach after server-current** | N×(1+F) worst; N+C best | Cold cache, reload, query change, eviction, LRU, hard reset, >30min, detach-during-change → **no firm billing guarantee** |
| 7 | **Continuous listeners for mounted route** | **N+C (~301)** | Cold load = N; >30min = +N; listener errors stop updates; **blind snapshots clobber optimistic/autosave** |
| 8 | Active-detail listener + focus-refresh lists | ~302 | Lists stay stale; may pick stale list before detail reconciles |
| 9 | One per-user revision **beacon** | ~362 | One missed bump → permanent staleness; extra write; global hotspot; "something changed" but not what |
| 10 | Per-domain beacons | ~366 | More machinery; cross-domain writes need multiple atomic bumps; still full-domain reread |
| 11 | Per-user change journal / tombstones | ~303 | Extra write; retention; ordering/idempotency; becomes a homemade sync protocol |
| 12 | FCM / Web Push invalidation | ~360 | Push is **not a correctness channel** (permission, drops, iOS/PWA limits) |
| 13 | BroadcastChannel / storage events | +0 Firestore | **Same-device tabs only** — cannot connect phone↔desktop |
| 14 | Custom server delta endpoint | ~max(1,C) | Server reads still hit quota; rebuilds a sync service |
| 15 | Listener on summary/projection docs | K+C (K≪N), e.g. 51 | Extra writes, projection drift, backfill — powerful reducer, more schema complexity |

Cross-cutting fragility: RQ hydration races the first snapshot; multi-tab may create multiple logical subscriptions; two persisted stores can restore different generations; storage eviction; rule-denial terminates listeners; account switch resurrects global RQ data; mobile suspension >30min; **full sermon docs are large & write-hot (embedded arrays)** → one edited sermon = 1 listener read on every active query matching it, even a title-only screen.

---

## 5. Recommended design (converged)

### 5a. Read freshness — stable, route-scoped listeners
- Use `onSnapshot` for the **direct-Firestore data the active route mounts**.
- **Keep each listener attached for the route's lifetime** (do NOT micro-detach on brief focus loss). Detach on **route unmount / UID change / logout**.
- Listen to the **active detail doc while an editor is open**.
- **Do not** register global listeners for every domain. **Do not** add a revision beacon initially.
- `includeMetadataChanges:true` → surface **"offline/saved copy"** (`fromCache`), **"syncing"** (until server-current), **"pending upload"** (`hasPendingWrites`), and a visible **error/retry** state when a listener terminates.
- Focus/reconnect reconciliation remains a **fallback after suspension** (esp. >30 min), not the primary mechanism.

### 5b. React Query integration — the actual hard part
- The **merge boundary is the hardest problem, not the `onSnapshot` call.** A snapshot must **not blindly overwrite** an entity carrying: a Firestore native pending write, an RQ optimistic mutation, a debounced autosave not yet queued, or a stored offline command.
- Feed listener data into existing RQ keys **only after persisted-query restoration completes**; **one subscription owner per canonical query** (not per component render).
- **Keep** React Query persistence (it owns offline startup, HTTP mutation replay, optimistic states, error recovery).

### 5c. Attachment seams (file:line)
Lifecycle: `firebaseClientDb.ts:28-36`, `QueryProvider.tsx:79-93`, `useServerFirstQuery.ts:51-65`.
List queries: `sermons.client.ts:107-112`, `studies.service.ts:96-100`, `prayerRequests.client.ts:53-62`, `series.service.ts:62-66`, `groups.service.ts:55-60`.
Hooks: `useDashboardSermons.ts:49-70`, `useStudyNotes.ts:17-24`, `usePrayerRequests.ts:63-71`, `useSeries.ts:44-53`, `useGroups.ts:26-34`, active detail `useSermon.ts:53-68`.

---

## 6. Write conflict — a SEPARATE track (the real cause of the overwrite bug)

A listener answers "what's the latest state I've observed", NOT "may my edit overwrite what another device saved". Firestore offline sync is **last-write-wins**. **No** read-freshness mechanism (refresh, focus, poll, listeners, resume tokens, beacons, push, BroadcastChannel, invalidation journals) solves conflicts.

**Vulnerable paths (whole-array read-modify-write):** thoughts `sermons.client.ts:345-385`; preach dates `sermons.client.ts:450-491`; prayer updates `prayerRequests.client.ts:100-124`; series membership `seriesMembership.client.ts:108-129` (its "read FRESH so never clobbered" comment `:14-22` is **too strong** — a batch is atomic but does **not** compare read-doc versions; `getDoc` can serve cache offline).

**Proportionate design (no CRDT):**
1. Monotonic server-controlled **`revision`** per editable doc.
2. Editor records the **base revision** it opened.
3. Online saves use a **transaction / compare-and-set** (rules can enforce `new.revision == old.revision + 1` with no dependent read).
4. On revision change: auto-merge field-disjoint edits; rebase ID-based add/remove where safe; **show a conflict** for non-mergeable text/structure/reorder/same-item.
5. Offline edits become **durable intentions in an outbox**, transacted/rebased on reconnect — a stale offline full-array replace must **never** be silently submitted.
6. Gradually normalize hot embedded arrays (thoughts/preach dates/prayer updates/series items) into **per-item docs** if conflicts persist.
Note: transactions **fail offline**; an offline rejection may arrive long after the optimistic UI accepted → durable conflict UX required.

---

## 7. Spark quota math

```
daily reads ≈ DAU × sessions × cold/current route docs + changed docs delivered + full rereads after long disconnects + other server/API/rules reads
```
20 DAU × 3 sessions × 300 docs = **18,000** cold reads; + ~40 change deliveries ≈ **~18,040/day ≈ 36% of 50k**.
- 500 docs/session → ~30,040 (60%). 30 DAU × 300 → ~27,040 (54%).
- Safer sync budget (reserve half for server routes/detail/retries/peaks) = **25,000/day ≈ 416 docs/session**.
- For comparison: two extra focus refetches at N=300 → 20×3×900 = **54,000/day — exceeds Spark alone.** Polling is worse.
- Conflict transactions per edit are **cheap** (tens/day). **The quota risk is refetching whole collections, not correctness.**
- **Dominant cost = the cold/initial N per session, not the changes.** So the real lever is **reducing N** (query shape) before any beacon: pagination/recent-limits; **server-query the calendar date range** instead of fetching all sermons and filtering locally (`sermons.client.ts:137-160`); **summary docs for dashboard cards** (dashboard mounts 5 whole-collection hooks — `dashboard/page.tsx:200-209`, the biggest multiplier); active/inactive filters; split large editing payloads from list records.

---

## 8. Failure modes the design MUST handle
Cold cache (loading until server-current, not "synced" on local emission); offline (label stale, preserve edits as pending); reconnect <30min (resume, measure reads); reconnect >30min (budget full query); listener error (surface; permission errors stop listeners); browser suspension (reconcile at resume before destructive edit); multi-tab (dedupe logical subscriptions); hydration race (listener waits for RQ restoration); pending-write race (never replace optimistic blindly); **account switch (clear/namespace query data + subscriptions by UID)**; storage eviction/private mode (degrade explicitly); deletion vs offline edit (conflict, never silently recreate/discard); multi-version schema/query changes; quota pressure (stop optional background refreshes first, keep active-detail correctness).

---

## 9. Must measure empirically before trusting
1. Doc cardinalities per user/route (esp. 5-query dashboard). 2. Reads split QUERY vs LOOKUP + active listeners (use Cloud Monitoring). 3. Billing experiments: cold cache / warm listener / detach-reattach <30min / reload <30min / detach-reload >30min / cleared IDB / forced GC / changed query shape. 4. Don't infer billing from callback counts — compare billed read metrics. 5. Listener metadata timelines. 6. Two-device conflict matrix (same field / disjoint / two array items / same item / reorder-vs-edit / both offline / both reconnect orders / delete-vs-edit / rule-denial after local accept). 7. Multi-tab dedup. 8. Mobile/PWA suspend/wake/eviction. 9. RQ restoration racing snapshots. 10. Logout→other account same browser. 11. Autosave burst rate & how often a large sermon doc changes while list listeners active. 12. SLO: remote edit visible ≤5s while both active; reconcile before editing after resume; zero silent overwrites; pending/conflict always recoverable after reload.

---

## 10. Converged decisions (what the Popper loop changed)

| Earlier idea (Claude) | Verdict after Popper | Why |
|---|---|---|
| Short-lived listener: attach→delta→detach per visit | **Rejected** | Resume-token delta billing is conditional, not guaranteed; each reattach risks a full reread. Long-lived route-scoped is cheaper AND more reliable. |
| Per-user revision **beacon** doc | **Not initially** | Redundant given route-scoped listeners; adds a write per mutation, a hotspot, and a "missed bump → permanent staleness" failure. Revisit only if p95 route N is large AND many domains need background freshness. |
| **Drop** React Query IDB persister (double cache) | **Rejected** | Offline startup renders from the RQ persister (queryFn disabled offline). Removing it breaks offline. Keep it; make the listener feed RQ *after* restoration. |
| "Just call `onSnapshot`" is the work | **Corrected** | The hard part is the **merge boundary** (don't clobber optimistic/pending/autosave) + the **separate write-conflict track**. |
| Read-freshness ≈ the whole problem | **Corrected** | Read-freshness and **write-conflict** are two tracks; the overwrite bug is the second one and needs revision+transaction+outbox. |

**One-line summary:** the reliable, cheap fit for this app is **stable route-scoped `onSnapshot` listeners on the active view (with explicit cache/syncing/pending/error UI, fed into React Query after restoration, RQ persistence kept), a focus/reconnect fallback after suspension, and a SEPARATE revision-based optimistic-concurrency + outbox track for write conflicts** — while the real quota lever is shrinking the per-session document count (query shape), not the sync mechanism.

---

### Provenance
Popper loop: Claude proposal → Codex `gpt-5.6-sol` (high effort, open mandate — free to enumerate its own failure modes and challenge the premise) → convergence. Sources cited by Codex: Firestore [pricing](https://firebase.google.com/docs/firestore/pricing), [realtime queries at scale](https://firebase.google.com/docs/firestore/real-time_queries_at_scale), [listen](https://firebase.google.com/docs/firestore/query-data/listen), [offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [monitor usage](https://firebase.google.com/docs/firestore/monitor-usage), and firebase-js-sdk source at tag firebase@11.2.0.

---

## 11. Popper ROUND 2 — falsifying the converged design against hard bars (B1 reliability, B2 quota at 100 users)

**VERDICT: the recommended design does NOT pass B1+B2 as-is.** Route-scoped listeners + revision/CAS are the right DIRECTIONS, but: B1 needs substantial protocol hardening; **B2 (literal "never blow Spark even at 100 users") is NOT achievable with pure client-side direct-SDK access** — you cannot atomically cap direct Web SDK reads/listeners against a daily budget, and Rules cannot debit a read counter. (Codex `gpt-5.6-sol` xhigh; code-facts 99%, quota-arithmetic 100%, arch-verdict 97%.)

### 11a. B1 — 11 concrete reliability holes (all P0 unless noted), each with a fix
1. **Revision bypass via legacy + Admin paths** — rules check only ownership (`firestore.rules:30`); server routes update sermon w/o revision bump (`api/thoughts-by-section/route.ts:19`, `api/repositories/sermons.repository.ts:53`); Admin audio writers bypass rules (`api/sermons/[id]/audio/generate/route.ts:542`). → revision protocol must cover EVERY web+admin writer via one shared transactional repo; rules enforce `revision==old+1`; min-client-version cutoff; drain period for already-queued legacy writes (partly unclosable → surface as conflict).
2. **Crash before durable outbox** — edit lives only in a React ref + 500ms debounce (`.../structure/hooks/usePersistence.ts:24,100`); tab killed → nothing persisted → lost. → write command to IndexedDB ATOMICALLY *before* projecting optimistic UI.
3. **Rule denial after reload** — offline write optimistically accepted, tab closes (error handler gone), reload → server rejects (UID/token/rules) → native pending overlay vanishes, no recoverable artifact (`QueryProvider.tsx:15` deliberately doesn't persist in-flight mutations). → native queue can't be the only outbox; keep command until server ACK + observed committed revision; `permission-denied` → durable failed/conflict with copy/export/retry.
4. **Old offline write lands after new CAS** — legacy whole-array `updateDoc` (`sermons.client.ts:322,450`) arrives last, wipes a transaction result w/o revision bump. → rules must reject ALL legacy writes before enabling the protocol; rejected old intent → recovery UI, never silently dropped.
5. **Outbox duplicate/reorder/head-of-line deadlock** — lost ACK + two tabs replaying + local-only opId → resurrect/lose data, or strict FIFO deadlocks the doc. → one sequencer per {uid,docId} w/ lease/auth-epoch; server transaction applies command + writes opId to a dedupe ledger; ACK only after commit; conflict → `blocked_conflict` (other docs keep syncing).
6. **ID-based array rebase undefined for reorder** — series passes reorder as full `itemIds[]` (`seriesMembership.client.ts:29`); rebasing full ID lists loses/resurrects/misplaces. → per-item docs + tombstones + item revisions + positional `move X after Y` ops; remove-vs-edit / move-vs-delete / same-text-edit are **unclosable automatically → mandatory visible conflict**. "Gradual normalization" is itself dangerous (old client writes embedded array, new writes subdocs) → one canonical writer + migration epoch, no dual-write w/o version gate.
7. **Delete vs offline edit** (`sermons.client.ts` set vs update) → revisioned tombstone w/ retention; offline-edit-vs-tombstone → conflict (restore-as-new / copy / export / discard). Auto-resolution impossible.
8. **Cross-account cache leak** — detail key omits UID (`useSermon.ts:53`), RQ persister global key (`queryPersister.ts:7`), logout clears neither (`useAuth.ts:39`). → UID in ALL keys/outbox/registries + auth epoch + synchronous purge on logout; never render a doc if `doc.userId !== activeUid`.
9. **Listener recovery zombie subscription** (P1) — retry timer reattaches old account/query after route/UID change. → subscription manager keyed {uid, authEpoch, routeGeneration, canonicalQuery}; classify errors (unavailable→retry; unauth/denied→wait for auth; failed-precondition→code bug; resource-exhausted→quota-red, no retry). "Recover from EVERY cause" is unclosable → explicit degraded/fatal state, not infinite retry.
10. **`includeMetadataChanges` is NOT a reconciliation gate** (P1) — after resume the listener emits `fromCache=true` first; user can hit a destructive edit before server-current. → editor state machine: destructive remote save allowed ONLY when auth epoch matches + listener generation active + `fromCache=false`.
11. **Browser storage destruction** — unclosable; clear-site-data/eviction/device-loss destroys the only offline copy. → if durable storage unavailable, block offline destructive editing OR mark "not durable" + export. Accepted, surfaced risk.

### 11b. B2 — corrected quota math (my earlier numbers were too optimistic)
Ceiling `Rday ≥ U × S × M + F + O` (U=DAU, S=cold/>30m sessions, M=Σ max(nᵢ,1) billed dashboard docs/session — dashboard mounts 5 whole-collection reads `dashboard/page.tsx:200`).
At S=3: **raw ceiling = 166 docs/session at 100 DAU** (167 → break). With a 50% reserve, only **83 docs/session** — NOT the "416" I wrote (that assumed 20 DAU). Power/shared accounts blow it: 99×200 + 1×1000 → 62,400; 90 + 10 power → 84,000; a 5-device shared account ×5 change-deliveries.
**Writes also tight:** revision + projection + dedupe-ledger ≈ w=2–4 writes/edit → 100 users × 50 edits × 4 = 20,000 exactly, before any server jobs.
**Guarantee? NO — only "probably."** Client pagination/caps reduce but can't guarantee: multiple devices, old versions, already-attached listeners keep issuing direct Firestore requests.

### 11c. What a REAL Spark guarantee requires (core topology change)
1. Remove direct production Web-SDK access to billable ops; route ALL reads/writes/Admin/listeners through a **quota-admission gateway**; old clients blocked by rules/version gate.
2. **Counter OUTSIDE Firestore** (so admission itself costs no reads); reserve worst-case cost per request up-front (don't wait for laggy Cloud Monitoring).
3. Hard project cutoff **40k reads / 15k writes/day** (10k/5k emergency reserve); per-account token budget (e.g. 300 read / 100 write tokens/account); shared devices share the UID budget.
4. **Bounded query shapes:** dashboard = ONE summary/projection doc; lists = cursor `limit(20)` no offsets; NO whole-collection listener; ≤1 active-detail listener/account; listeners have a finite read lease → auto-degrade to manual refresh.
5. **Red mode:** at budget exhaustion, gateway runs no Firestore op, listeners detach, focus/reconnect refetch off; UI from cache; edits → durable outbox, replay after reset; user sees stale/pending/export UI.
6. Backlog replay: per-account rate limit + coalescing + reservation by real worst-case w; short of tokens → `deferred_until_reset`, not a server attempt.
7. **No bypass:** telemetry/cron/API/console/Admin all use the same budget or a strictly-capped system pool.
Simpler alternative to app-death: **Blaze** — but it does NOT keep you in free tier and budget alerts don't cap spend (they notify).

### 11d. Write-conflict hardening (to make "zero silent overwrites" literally true)
revision + schemaEpoch + deletedAt on every editable doc; ONE CAS protocol across web/API/Admin/jobs (rules require exact revision+1; Admin repo does the same in code); outbox command carries {uid, authEpoch, opId, docId, baseRevision, schemaVersion, payload, deps} — never stale full snapshots; durable append BEFORE optimistic projection; apply + opId-ledger write in ONE transaction (callback must not touch UI — may re-run); one FIFO executor per doc, conflicts don't retry forever nor block other docs; scalars → true 3-way merge vs base (same-scalar edit → conflict); arrays → per-item docs (delete=tombstone, reorder=positional ops, no dual writers); multi-step actions atomic (dashboard currently does status/date as separate writes + `Promise.all` same-doc array updates `mutationDefaults.ts:592` → one transaction/saga); NO whole-snapshot rollback (late `onError` restores old sermon and can wipe a newer optimistic edit `mutationDefaults.ts:565` → roll back only if optimistic head still owns the same opId).

### 11e. ROUND-2 VERDICT
- **B1 CAN become trustworthy** with the protocol hardening above (real work; several current-code bugs to fix; some conflicts are inherently unclosable → must be surfaced, not auto-resolved).
- **B2, literally ("never blocked even at 100 users on Spark"), requires a core change** — a quota-gated backend gateway — OR relax the bar to *graceful degradation* (bounded queries + red-mode: app goes stale/read-only under peak, never data-loss, never surprise-bill) which is achievable client-side but is "very safe + degrades safely," NOT a hard guarantee. **The recommended design as-is is NOT ship-ready.**
- **Cheapest highest-value win regardless of path:** kill the dashboard's 5 whole-collection reads (one summary/projection doc) + hard-paginate lists (`limit(20)` cursors) + server-filter the calendar date range. This is what actually moves the quota needle.

**Decision fork (needs the owner's call):** (A) accept *graceful degradation* on Spark (bounded queries + caps + red-mode + write-conflict hardening) — no hard guarantee but no data-loss/no app-death, moderate work; (B) build the *server quota-gateway* for a true guarantee — bigger change; (C) move to *Blaze* + strict budget caps/alerts — accepts possible spend, removes shutdown. Write-conflict hardening (11d) is needed in ALL three (it's the root of the real overwrite bug).
