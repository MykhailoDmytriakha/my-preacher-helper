when: npm run lint · lint:full · lint:unused · lint fails after moving files · import/order · There should be at least one empty line between import groups · import should occur before import of · Cognitive Complexity · sonarjs/cognitive-complexity · Refactor this function to reduce its Cognitive Complexity · no-duplicate-string · Define a constant instead of duplicating this literal · no-explicit-any · unused-imports · workbox-*.js lint errors · public/sw.js linted · swe-worker · eslint.config.mjs · линтер · ошибки линта · линт падает · порядок импортов · когнитивная сложность · дублирующаяся строка · неиспользуемые импорты · tens of thousands of lint problems · 61985 problems · errors in .next-note-fix-build · lint walks into build output · .next-* folders · линтер ругается на сборочные папки · тысячи ошибок eslint

# Fix lint errors

`npm run lint` is `eslint .` in `frontend/`, with every rule in `frontend/eslint.config.mjs`. The full gate is `npm run lint:full`: lint, then `lint:unused` (`tsc -p tsconfig.unused.json` with `noUnusedLocals`), then `tsc --noEmit`. Errors fail the gate; the two sonarjs rules are warnings, and you fix them anyway.

## How

- Tens of thousands of problems, all under `frontend/.next-<name>/`: that is build output of a second dev server or an isolated build left on the disk (git ignores `/frontend/.next-*/`), not source. `eslint.config.mjs` ignores `**/.next-*/**` since 2026-11-12 (before that only `.next` and `.next-typecheck`: 61 985 problems, 9 519 errors, none in a tracked file). A new build folder takes a name of that shape, so lint never reads it.
- `import/order` (error): groups go builtin → external → internal (`@/...` aliases) → parent → sibling (`./...`) → index → object → type, with a blank line between groups and alphabetical order inside each. After moving page-local constants or types into sibling files, keep a blank line between the `@/...` imports and the `./...` imports, and put `import type` lines in their own last group. `npx eslint --fix <file>` reorders them for you.
- `sonarjs/cognitive-complexity` (warning above 20): move state and effects into a custom hook, rendering into a sub-component, and nested ternaries into a content component with early returns or a map/object lookup.
- `sonarjs/no-duplicate-string` (warning at 3 identical literals): extract a constant.
- In test files `import/order`, `no-duplicate-string` and `@typescript-eslint/no-explicit-any` are off; in app code `no-explicit-any` and `unused-imports/no-unused-imports` are errors.
- Generated service-worker files are not linted: `**/public/sw.js` and `**/public/workbox-*.js` sit in the `ignores` block. Serwist also writes `public/swe-worker-*.js`, which is not in that list; it lints clean today. If it ever reports errors, add it to `ignores`; never edit a generated file.

## Traps

- Run ESLint after the production builder finishes. Serwist replaces `public/swe-worker-*.js`; a concurrent `eslint .` can enumerate the old file and then fail with ENOENT when the builder removes it. Preserve that failed attempt and rerun lint on the finished tree; do not edit the generated worker.

- Lint is not a deploy gate. `next.config.mjs` sets `eslint.ignoreDuringBuilds: true` and `npm run build` never calls eslint, so a lint error reaches `main` unless `npm run lint:full` ran before the push.
- `eslint .` has no `--max-warnings`: complexity and duplicate-string warnings never turn the command red. They stay rules to fix, not noise to ignore.

## Why

- 2026-02-27: extracting page constants and types into sibling files broke the lint gate on `import/order`, because the blank lines between the alias, relative and type groups were missing.
- 2026-01-15: generated worker scripts in `public/` were linted and failed; they were added to the ignores.

See also: `.howto/fix-hook-order-errors.md` · `.howto/get-a-deploy-through-vercel.md`
