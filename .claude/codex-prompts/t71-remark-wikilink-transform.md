**T71 — Replace `transformWikiLinks` regex-rewrite with a remark/mdast transform that skips code blocks.**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`. Uses `react-markdown` + `remark-gfm`.

## Problem
`app/components/MarkdownDisplay.tsx` has `transformWikiLinks(text, resolver)` that does a raw regex `text.replace(WIKI_LINK_PATTERN, …)` over the entire markdown string **before** passing it to ReactMarkdown. This rewrites `[[id]]` even inside fenced code blocks and inline code, where it should remain literal.

## Fix
Implement a remark plugin (`remarkWikilinks`) that visits text nodes in the mdast tree and rewrites `[[id]]` matches into mdast `link` nodes with `type: 'link'`, `url: /studies/<id>#wiki`, and children `[{type:'text', value:'● <label>'}]`. **Skip nodes whose ancestor is `code`, `inlineCode`, or `link` itself** (don't replace inside existing links).

## Constraints
1. **Keep API identical**: `MarkdownDisplay` still accepts `enableWikiLinks` and `wikilinkResolver` props with same semantics — when `enableWikiLinks=true`, plugin is added to `remarkPlugins`; otherwise not.
2. **The `#wiki` hash marker** must remain so the `a:` renderer detects wikilinks vs hand-authored study links (this distinction was added recently, important for correctness).
3. **Constants** from `app/components/studies/node/wikilinkConstants.ts` — use them (`WIKILINK_CHIP_GLYPH`, `WIKILINK_ID_REGEX_SOURCE`, `STUDIES_LINK_PREFIX`).
4. Use `unist-util-visit` for tree traversal (already transitive dep through remark — if not installed, add it). Or roll a simple recursive visitor manually.

## Deliverables
- `app/components/MarkdownDisplay.tsx` — remove `transformWikiLinks` function; pass new `remarkWikilinks({ resolver })` plugin into `remarkPlugins`. Plugin can be defined inline in MarkdownDisplay.tsx or extracted to `app/components/markdown/remarkWikilinks.ts` (your call — prefer extraction if it keeps MarkdownDisplay readable).
- Test (existing `app/components/__tests__/MarkdownDisplay.*` if any, or new) verifying:
  - Plain prose `[[abc]]` → chip with `#wiki` href.
  - Fenced code block ``` \n[[abc]]\n ``` → literal `[[abc]]`, no chip.
  - Inline code `` `[[abc]]` `` → literal `[[abc]]`, no chip.
  - Inside an existing `[label](/some/url)` link, `[[abc]]` stays literal in label.

## Acceptance
- `npx tsc --noEmit` passes.
- All MarkdownDisplay-related tests pass + new ones.
- Studies page renders correctly (no regressions in `npx jest "studies/\[id\]/__tests__"`).

No commits. Only the listed files.
