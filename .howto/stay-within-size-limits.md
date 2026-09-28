when: payload too large · 413 · document exceeds maximum size · Base64 images too big · text too long for Firestore · request body limit · Vercel 4.5 MB · Firestore 1 MiB document · feedback with screenshots fails · Image is too large · Feedback payload is too large · getUtf8ByteLength · MAX_FEEDBACK_PAYLOAD_BYTES · MAX_FEEDBACK_TEXT_BYTES · MAX_FEEDBACK_IMAGE_BYTES · attachment budget · byte cap · sourceTooLarge · MAX_CUT_CHARS · Maximum call stack size exceeded at RegExp.exec · слишком большой запрос · размер документа · лимит размера · картинки слишком большие · отзыв со скриншотами не отправляется · слишком длинный текст · переполнение стека

# Stay within size limits

Size every boundary on its own: the decoded file, the serialized request, and the stored document are different resources with different ceilings, and passing one says nothing about the others. The worked example is feedback: limits in `frontend/app/utils/feedbackPayload.ts`, checked in `frontend/app/components/navigation/FeedbackForm.tsx`, again in `submitFeedback` (`frontend/app/services/feedback.service.ts`) and again in `frontend/app/api/feedback/route.ts`.

## How

- Transport: cap the actual serialized body in bytes — `getUtf8ByteLength(JSON.stringify(payload))`, not `.length` (a Cyrillic letter is 2 bytes). `MAX_FEEDBACK_PAYLOAD_BYTES = 4_400_000` leaves headroom below Vercel's 4.5 MB request-body limit. Check it before the browser `fetch` (`submitFeedback` checks the final body, diagnostics included) and again on the server over the raw text before `JSON.parse` → 413.
- Per file: cap the decoded size of each image (`MAX_FEEDBACK_IMAGE_BYTES`, 3 MB; `getFeedbackImageDecodedSize` computes it from the Base64 length). Several individually valid images can still exceed the transport cap together, so the form also checks the combined size when an image is added (`MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES`).
- Stored document: a separate byte cap on the text that is persisted, below Firestore's 1 MiB document limit — `MAX_FEEDBACK_TEXT_BYTES = 900_000`. A request can fit the gateway while its text still breaks the document. Images are not stored in Firestore at all: `storeFeedbackInDatabase` strips them and keeps `imageCount`; email carries them.
- Tell the person the limits before they hit them: per image and total (`feedback.imagesNote`), remaining attachment budget (`feedback.attachmentBudgetRemaining`), and a live text counter (`feedback.textBudget`), in all three locales.
- A 413 is final, not a retry: `submitFeedback` maps it to `invalid-argument` so the form never says "try again".
- Other routes refuse oversize input up front with 413 instead of truncating or dying mid-flight: note-plan source over 200,000 characters → `sourceTooLarge` (`frontend/app/api/sermons/[id]/plan/route.ts`); a note longer than `MAX_CUT_CHARS` (`frontend/app/api/studies/notes/[id]/cut/route.ts`); oversized orders (`frontend/app/api/service-orders/route.ts`). The data engine refuses a command over `MAX_COMMAND_BYTES` (1 MiB) with `resource-exhausted` (`frontend/app/data-engine/server.ts`).

## Traps

- A ~3 MB image answered 500 on Vercel and passed locally → a regex that captured the whole Base64 body ran out of stack (`RangeError: Maximum call stack size exceeded at RegExp.exec`). Match only the `data:image/...;base64,` header with a regex and scan the body by hand (`isBase64Body`).

## Why

- 2026-07-14: requests fit under the gateway limit while unbounded text exceeded the database document limit, and valid images together exceeded the transport limit; each boundary got its own cap.
- 2026-07-28: the whole-body Base64 regex overflowed the stack on the Vercel build machine, so a too-large image was reported as "something went wrong" instead of "too large".
