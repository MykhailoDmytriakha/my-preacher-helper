when: after create the old page flashes · navigate after create · router.push then close modal · modal closes and the dashboard shows · create then redirect · empty form flashes after save · create-then-attach · onNewSermonCreated · closeOnSuccess · awaitAcceptance · /prayers/[object Object] · second sermon created on retry · add new sermon to series · переход после создания · мигает старая страница · модалка закрылась и видно дашборд · создать и перейти · пустая форма мелькает после сохранения · вторая проповедь при повторе · new item lands off screen · created at the end of a long list · bring the new item into sight · создал, а не видно, куда встало · новая группа внизу страницы

# Navigate after creating something

When a modal creates an entity and then leaves the page, keep the modal open and locked in its saving state until the route change unmounts it: App Router `router.push` is fire-and-forget, so closing first shows the source page after a success. Live example: the dashboard's prayer create in `frontend/app/(pages)/(private)/dashboard/page.tsx` (`CreatePrayerModal` with `closeOnSuccess={false}`).

## How

- Lock, don't close: with `closeOnSuccess={false}` the modal keeps `saving` true and its close button disabled (`closeDisabled={saving}` in `frontend/app/components/prayer/CreatePrayerModal.tsx`); the parent awaits acceptance, then pushes; the unmount closes the modal.
- Push to the id the write minted (`submission.prayerId`), after `await awaitAcceptance(submission, ...)` from `frontend/app/utils/recoverableWrite.ts`. Awaiting the submission object itself resolves at once to the object.
- A create that can be queued offline has no server document yet: navigate only when `acceptance.kind === 'persisted'`, otherwise stay (the legacy dashboard sermon create, `onCreateRequest`). On a collection already on the data engine the create modal closes once the engine has queued the create and does not navigate (`EngineCreateSermonModal`).
- Create-then-attach: when the parent has a second async step before close (attaching the new sermon to a series), the modal awaits the parent callback before it resets its form: `await onNewSermonCreated(...)`, then `resetForm()`, in `frontend/app/components/AddSermonModal.tsx`. Resetting first leaves a still-open modal showing an empty form, which reads as data loss.
- Staying on the page, the new item may land where the eye is not: a group added from the header of a long theme goes last, screens below the button. Bring it into sight once it is on the page and light it a moment, then let the light go on its own clock (`useGroupArrival` in `care/questions/[themeId]/page.tsx`; the clocks as in `.howto/take-an-address-way-in.md`). The add resolves to the item's id, so the page knows what to bring.
- Once the entity exists, the parent's second step must not rethrow. The series page catches a refused attach and leaves it to the membership recovery (`useSeriesMembership`); rethrowing makes the form treat a successful create as a failure, and the obvious retry creates a second sermon.

## Why

- 2026-11-26: the owner could not find where a theme's groups are made — «+ Группа» stood under the last group, 5.8 screens down; it moved to the theme's header, and the new group is brought into sight.

- 2026-05-10: a dashboard modal closed right after `router.push`, and the person saw the dashboard after a successful create.
- 2026-04-14: creating a sermon from a series page, the modal reset its form before the parent finished attaching the sermon, and the open modal flashed empty.

See also: `.howto/move-a-route-url.md`
