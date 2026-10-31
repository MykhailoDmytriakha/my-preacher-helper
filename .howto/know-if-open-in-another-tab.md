when: open in another tab · two tabs · other tab · cross-tab · leftover cleanup cancels a window open elsewhere · closedOnly sees only this tab · Web Locks · navigator.locks · открыто в другой вкладке · две вкладки · уборка остатков отменила чужое окно

# Know whether something is open in another tab of this browser

The engine's `closedOnly` (`listMembershipRecovery`, `data-engine/engine.ts`) knows only this tab's open forms: a window open in another tab looks closed. Before settling what a «gone page» left — throwing a draft away, finishing a Save — ask the browser's Web Locks through `frontend/app/utils/openInTab.ts`. Do not write another cross-tab signal over `localStorage` or `BroadcastChannel`.

## How

- While the thing is open, hold its lock: `useEffect(() => (id ? holdWhileOpen(\`kind:${id}\`) : undefined), [id])`. The lock goes with the tab — a closed or crashed tab holds nothing.
- Before settling a leftover: `const open = await heldInSomeTab(\`kind:${id}\`)` — `true` open somewhere (leave it), `false` held by no tab (a gone page left it), `null` this browser cannot tell.
- Decide `null` by consequence: never throw away on `null`; an action whose repetition is harmless (finishing a pressed Save under the same identity) may go on. Example: `EngineCreateSermonModal.tsx` `open()`.
- Tests: jsdom has no `navigator.locks`. Install a fake that counts holders per name (`request(name, held)` keeps it until `held()` settles; `query()` lists names) — `__tests__/components/EngineCreateSermonModal.test.tsx`; «another tab» is `holdWhileOpen(name)` called by the test; delete the property to test `null`.

## Why

- 2026-10-31, case `2026-10-12-block-diagram`, Codex duet round 1: «Новая проповедь» threw away half-made sermons a closed page left, using `closedOnly`; with the window open in tab A, opening it in tab B cancelled A's sermon being typed. Round 2: treating «cannot tell» as «open» also stopped finishing a pressed Save — hence the decision by consequence.

See also: `.howto/keep-a-device-choice.md` (a setting on this device, not a tab signal).
