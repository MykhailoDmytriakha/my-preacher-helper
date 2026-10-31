when: sync cost · collection read amplification · repeated collection rows · logical SDK reads · unchanged IndexedDB writes · collection cursor cost · лишние чтения движка · повторное чтение страниц · неизменённые записи устройства

# Measure data-engine synchronization cost

Measure before changing freshness or persistence rules. Use the isolated Auth/Firestore emulator recipe, fake server credential and production deny guard. Pin the existing source/build and compiled emulator endpoint first. Never estimate the owner's production bill from a count of browser HTTP requests.

## Separate the quantities

- Record actual server SDK read calls and their returned document paths, with a transaction identity. One query call can return many documents. Keep transactions that write separate from read-only collection requests. A read-only observer returns the original SDK promise and result; record its source hash and label the instrumented process honestly.
- Capture completed browser IndexedDB mutations by database/store/resource. Count transaction completion, not only calls to `put`; an aborted transaction stored nothing. Preserve the first positive writes to prove the observer works.
- Record native action windows, actual API responses, canonical acknowledgements and device readbacks independently. Direct browser head subscriptions, empty-query billing minimums and production billing are different quantities; logical SDK result counts do not prove their billed cost.

## Cold and warm are different paths

The first list on a device must retain its live rows and deletion tombstones. The first detail can additionally initialize tags or templates: those are new useful copies, not repeated writes of unchanged sermons. Record this initialization, then repeat the already-seen detail/Back path and reload. Keep per-collection and whole-device counts distinct.

Apply one independently acknowledged same-owner update and verify one changed resource reaches the actual browser cache while all other snapshots remain equal. A quiet already-known list must not repeatedly persist equal snapshots or cursors. Use actual native navigation and observed viewport dimensions; do not replace the engine with a mock fixture.

For cold pagination, group each query by its actual transaction's collection head and compare all returned SDK document paths, distinct paths and emitted HTTP page snapshots. Two separate live/tombstone queries can each fetch `limit+1`, discard an unreturned tail after merging, then re-read that tail from the shared next cursor. Keep deletion rows in the comparison: dropping them would hide work from another own device. `server.ts:listDocuments` is the shared pagination owner; screen-specific trimming cannot reduce its database reads.

## Preserve failed setup boundaries

Canonical creates use `generation:null`; their operation ID becomes the generation. Keep the real refusal before diagnosing application behavior. A synthetic login may send the exact `{ operation: 'heartbeat', patch: {} }` through the existing settings protocol; parse that JSON before applying a narrowly authenticated local-only allow rule. Do not allow general profile mutations. Retain excluded attempts and unchanged replay contracts, inspect settled images, export the owned emulators, stop all owned processes and consume their actual exits.
