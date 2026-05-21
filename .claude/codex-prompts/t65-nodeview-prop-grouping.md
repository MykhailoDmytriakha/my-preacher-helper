**T65 — Group NodeView props into semantic clusters (treeActions / capabilities / state).**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`. TS strict.

## Problem
`app/components/studies/node/NodeView.tsx` has grown to **25+ props**. Call sites in `app/components/studies/node/NodeTreeEditor.tsx` spread 15+ props per render. Mechanical refactor — no behavior change.

## Fix
Reshape `NodeViewProps` from a flat list into three nested groups:

```ts
interface NodeViewProps {
  node: ContentNode;
  depth: number;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  currentNoteId?: string;
  readOnly?: boolean;
  wikilinkResolver?: (id: string) => string | undefined;

  state: {
    isFocused: boolean;
    isEditing: boolean;
    showActions: boolean;
    isRoot: boolean;
    hasChildren: boolean;
    isCollapsed: boolean;
  };

  capabilities?: {
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    canDemote?: boolean;
    canPromote?: boolean;
  };

  treeActions: {
    onFocus: () => void;
    onStartEdit: () => void;
    onHeaderChange: (v: string) => void;
    onTextChange: (v: string) => void;
    onToggleCollapse: () => void;
    onMediaRemove: (mediaId: string) => void;
    onMediaAdd: (media: ContentNodeMedia) => void;
    onAddChild: () => void;
    onAddSibling: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDemote: () => void;
    onPromote: () => void;
    onDeleteNode: () => void;
    onSplitFromMarkdown: (text: string) => void;
  };
}
```

Inside `NodeView.tsx` destructure the groups:
```ts
const { isFocused, isEditing, /* … */ } = state;
const { canMoveUp = true, canMoveDown = true, canDemote = true, canPromote = true } = capabilities ?? {};
const { onFocus, onStartEdit, /* … */ } = treeActions;
```

Update **all NodeView call sites** (two in `NodeTreeEditor.tsx` — readOnly path ~line 605 and editable path ~line 685) to pass the new grouped shape.

Update **NodeView.test.tsx** fixture: `defaultHandlers` becomes `defaultTreeActions`, `defaultState`. Test renders use `state={...}` `treeActions={...}` `capabilities={...}`. Don't change test assertions — only fixture shape.

## Constraints
1. **No behavior change.** Visual + functional identical.
2. **TS strict** — no `any`. Optional `capabilities` with all-optional fields (consumer can omit to get default `true`).
3. All existing tests pass without changes to assertions.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest app/components/studies/node` — 53+ tests pass.
- Final NodeView prop interface visibly cleaner — count groups, not 25 flat props.

No commits. Files: NodeView.tsx, NodeTreeEditor.tsx, NodeView.test.tsx.
