when: email the owner · notify the owner · owner notice · OWNER_EMAIL · nodemailer · sendOwnerNotice · ownerMail.server · letter to the owner · feedback email · referral warning email · письмо владельцу · уведомить владельца · отправить письмо

# Notify the owner by email

Every letter to the owner goes through `frontend/app/services/ownerMail.server.ts`: one transport, one `OWNER_EMAIL`, the same `EMAIL_*` environment variables. `sendOwnerNotice({ subject, text, html })` skips quietly (returns false) when the mail credentials are not set and throws when sending fails. Feedback (`frontend/app/api/feedback/route.ts`) and the referral check (`frontend/app/api/referral/claim/route.ts`) both use it.

## How

- Send after the work committed, never inside a Firestore transaction: the SDK re-runs the callback, and a letter sent from a callback is sent once per attempt.
- Send from the change that caused the notice, not from every request that sees it: the referral claim sets `referralWarning` only when it is absent and reports that back from the transaction, so only the claim that set the flag writes the letter.
- Count what triggers a notice where the transaction already reads: the referral count is a ledger on the inviter document every claim reads and writes, not a new query (the SDK boundary test freezes Firestore calls per file — `__tests__/architecture/README.md`).
- A letter that cannot be sent never fails the person's action. Log it and leave the record that made the notice (the flag) where the admin page shows it.
- The person never waits for the letter: the claim hands the notice to `after()` from `next/server`, which runs it once the response is sent and keeps the function alive for it (a throw from `after` outside a request scope falls back to running it detached). Still bound the whole notice, not only the send — the email lookups in Auth can stall as long as the mail server, and nodemailer's own waits reach an hour: past `OWNER_NOTICE_BUDGET_MS` no letter starts, and `sendOwnerNotice(…, { timeoutMs })` caps the mail server's waits to what is left (a non-pooled transport cannot be aborted mid-send). Feedback passes no `timeoutMs` and keeps its transport as it was. With no mail configured, skip the lookups altogether.
- A count that history must seed is set from the full record, once, by an owner-run script — not merged with a partial copy: the ledger keeps only the last twenty invitees, so `scripts/backfill-referral-ledger.js` recounts each inviter inside one transaction with the inviter document from everything known — its referral events and the invitees the ledger already lists (only a claim writes that list, so an invitee whose event was later overwritten is still real) — never lowering the count. Run such a script only after the old writer has drained: wait longer than a function can run after the deploy turns green, or the old writer adds history the script never sees. And trust a stored value only if no client could have written it: the rule protecting the field ships before the code that names it.
- Escape every user-supplied value in the HTML part with `escapeHtml` from the same module.

- A feedback document lives 90 days (owner, 2026-10-10); the letter in the mailbox stays. `api/feedback/route.ts` writes `expiresAt` (a Date, stored as a timestamp) = `createdAt` + 90 days for a Firestore TTL policy on collection group `feedback`, field `expiresAt` (Google Cloud console → Databases → the database → Time-to-live). The policy needs a billed project: on 2026-10-10 it was refused with «403: Project my-preacher-helper has billing disabled». Deleting from the route instead would add direct Admin SDK calls, which the DataEngine boundary test forbids (`__tests__/architecture/README.md`). Documents written before 2026-10-10 got `expiresAt` by a one-time backfill.

## Why

- 2026-10-04: the referral check (F6) needed a second letter; the transport, address and escaping lived inside the feedback route, so they moved here instead of being copied.
