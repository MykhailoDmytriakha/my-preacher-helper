when: required field · field must not be empty · save refused · validation message · save button disabled · button needs two presses · field added on blur · list input · at least one entry · обязательное поле · нельзя сохранить без · кнопка «Сохранить» неактивна · нажимать дважды · поле добавляется при уходе · хотя бы одно · подсказка под полем · основание без места Писания

# Require a field before saving

A form that may not be saved without something (a basis without a place of Scripture, 2026-11-26) refuses the save and says why under the field; it does not switch the button off.

## How

- The rule lives in the domain module, one function both the form and the writer use: `standsOnScripture(refs, locale)` in `frontend/app/utils/hardQuestions.ts`. The form reads it; the hook keeps a cheap backstop of its own (`saveBasis` refuses an empty list before writing).
- «Сохранить» stays pressable. A list field that takes a typed entry when it is left (`ListInput` adds on blur) adds it during the very press: the mouse-down leaves the field, the click lands after. A button switched off until the entry is in would ignore that first press, and the person presses twice.
- On a refused save: the message under the field (`role="alert"`, the input gets `aria-invalid` and `aria-describedby` to it), the cursor in the field. Adding what was missing clears it — the message shows only while asked and still lacking (`usePlacesRule` in `frontend/app/components/hardQuestions/themeForms.tsx`).
- Words that are not the thing do not count: a place is one a Bible can open (`readablePlaces`), so «стыдливость» or «Рим 25» in the list does not satisfy the rule.
- Records kept before the rule are not touched. They show what they lack where they are listed («места Писания не указаны») and are saved again only with it.

## Check

A page test presses save with the field empty (alert, focus, no write), with only wrong entries (still no write), then with a right one (written). Live: type the entry and press save at once — one press saves (`.cases/2026-11-25-slozhnye-voprosy-koncepciya/stand/walk11.cjs`).

See also: `.howto/open-a-modal.md`
