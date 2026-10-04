when: Firestore reads per day · read cost · how many reads · Spark 50K limit · RESOURCE_EXHAUSTED · document/read_count · Cloud Monitoring 403 · Permission denied (or the resource may not exist) · monitoring.viewer · Usage tab · сколько чтений в день · расход чтений · лимит чтений · замер чтений Firestore · стоимость базы

# Measure Firestore reads per day

The number that matters is document reads per day against the Spark limit of 50K/day. The history to compare with lives in memory `project_data_engine_branch.md` (2026-09-27 paragraph: 6.5K and 8.5K a day with the engine on and the 15 s polling bug; 1–5K on active days before the engine).

## Where the number is

- **Firebase console → Firestore → Usage** — per-day reads, the owner's login. This is the source every earlier measurement used. An agent reads it only in the owner's own browser, with his word.
- **Cloud Monitoring** — metric `firestore.googleapis.com/document/read_count`, `ALIGN_SUM` per hour plus `REDUCE_SUM`, summed by Pacific date (the console's day). The app service account (`FIREBASE_SERVICE_ACCOUNT` in `frontend/.env.local`) answers **403 Permission denied**: it has no `roles/monitoring.viewer`. Granting that role is the owner's call (a security setting). Once it is granted, the agent can measure without the console.

## Traps

- Decode the service account in code and never print it (one key was printed by accident once).
- Reads only happen while the app is open and visible. A quiet day is not a fix. Compare days of similar use, and name the day's activity next to the number.
- Polling and liveness checks scale with open tabs and devices. Forgotten headless tabs from live checks hit the shared base (memory `feedback_close_polling_tabs.md`).
