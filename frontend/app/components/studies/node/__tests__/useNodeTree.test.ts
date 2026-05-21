import { act, renderHook } from '@testing-library/react';

import { ContentNode } from '@/models/models';

import { flatten, selectAncestorIds, selectFlat, selectTree, useNodeTree } from '../useNodeTree';

function makeTree(): ContentNode {
  return {
    id: 'root',
    header: 'Root',
    children: [
      {
        id: 'a',
        header: 'A',
        text: 'Alpha',
        children: [
          { id: 'a1', text: 'Alpha child' },
        ],
      },
      { id: 'b', header: 'B' },
      { id: 'c', text: 'Charlie' },
    ],
  };
}

function renderNodeTree(root: ContentNode = makeTree()) {
  return renderHook(() => useNodeTree(root));
}

function childIds(node: ContentNode | undefined): string[] {
  return node?.children?.map((child) => child.id) ?? [];
}

describe('useNodeTree', () => {
  it('creates initial normalized state from a flat root', () => {
    const root: ContentNode = { id: 'root', header: 'Root' };
    const { result } = renderNodeTree(root);

    expect(result.current.state.rootId).toBe('root');
    expect(result.current.state.nodes.root).toEqual(root);
    expect(result.current.state.focusedNodeId).toBeNull();
    expect(result.current.selectors.selectFlat()).toEqual([
      { id: 'root', depth: 0, hasChildren: false, isCollapsed: false },
    ]);
  });

  it('handles setFocus, setRoot, startEdit, and stopEdit', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'setFocus', nodeId: 'a' });
      result.current.dispatch({ type: 'startEdit' });
    });

    expect(result.current.state.focusedNodeId).toBe('a');
    expect(result.current.state.isEditingText).toBe(true);

    act(() => {
      result.current.dispatch({ type: 'stopEdit' });
      result.current.dispatch({ type: 'setRoot', root: { id: 'next-root', text: 'Next' } });
    });

    expect(result.current.state.rootId).toBe('next-root');
    expect(result.current.state.focusedNodeId).toBeNull();
    expect(result.current.state.isEditingText).toBe(false);
    expect(result.current.selectors.selectTree()).toEqual({ id: 'next-root', text: 'Next' });
  });

  it('updates header and text while preserving untouched node references', () => {
    const { result } = renderNodeTree();
    const untouchedBefore = result.current.state.nodes.b;

    act(() => {
      result.current.dispatch({ type: 'updateHeader', id: 'a', header: 'Updated A' });
      result.current.dispatch({ type: 'updateText', id: 'a', text: 'Updated text' });
    });

    expect(result.current.state.nodes.a).toMatchObject({
      header: 'Updated A',
      text: 'Updated text',
    });
    expect(result.current.state.nodes.b).toBe(untouchedBefore);
  });

  it('inserts a sibling after the target and focuses it', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'insertSibling', id: 'a', newId: 'new-sibling' });
    });

    const tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'new-sibling', 'b', 'c']);
    expect(result.current.state.focusedNodeId).toBe('new-sibling');
  });

  it('inserts a child under the target and focuses it', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'insertChild', id: 'b', newId: 'new-child' });
    });

    const tree = result.current.selectors.selectTree();
    const nodeB = tree.children?.find((child) => child.id === 'b');
    expect(childIds(nodeB)).toEqual(['new-child']);
    expect(result.current.state.focusedNodeId).toBe('new-child');
  });

  it('deletes a node subtree and focuses the previous sibling', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'deleteNode', id: 'b' });
    });

    const tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'c']);
    expect(result.current.state.nodes.b).toBeUndefined();
    expect(result.current.state.focusedNodeId).toBe('a');
  });

  it('deletes the first child and falls back to focusing the parent', () => {
    const { result } = renderNodeTree({
      id: 'root',
      children: [{ id: 'first' }, { id: 'second' }],
    });

    act(() => {
      result.current.dispatch({ type: 'deleteNode', id: 'first' });
    });

    expect(childIds(result.current.selectors.selectTree())).toEqual(['second']);
    expect(result.current.state.focusedNodeId).toBe('root');
  });

  it('blocks deleting the root node', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'deleteNode', id: 'root' });
    });

    expect(result.current.state.rootId).toBe('root');
    expect(result.current.state.nodes.root).toBeDefined();
  });

  it('promotes a node after its parent and blocks children already under root', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'promote', id: 'a1' });
    });

    let tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'a1', 'b', 'c']);
    expect(childIds(tree.children?.[0])).toEqual([]);

    act(() => {
      result.current.dispatch({ type: 'promote', id: 'b' });
    });

    tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'a1', 'b', 'c']);
  });

  it('demotes a node under the previous sibling and blocks when no previous sibling exists', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'demote', id: 'b' });
    });

    let tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'c']);
    expect(childIds(tree.children?.[0])).toEqual(['a1', 'b']);

    act(() => {
      result.current.dispatch({ type: 'demote', id: 'a' });
    });

    tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'c']);
  });

  it('moves nodes up and down but no-ops at sibling edges', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'moveUp', id: 'c' });
    });

    expect(childIds(result.current.selectors.selectTree())).toEqual(['a', 'c', 'b']);

    act(() => {
      result.current.dispatch({ type: 'moveDown', id: 'c' });
      result.current.dispatch({ type: 'moveUp', id: 'a' });
    });

    expect(childIds(result.current.selectors.selectTree())).toEqual(['a', 'b', 'c']);
  });

  it('moveNode reorders a node within the same parent', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'c', targetParentId: 'root', targetIndex: 1 });
    });

    expect(childIds(result.current.selectors.selectTree())).toEqual(['a', 'c', 'b']);
  });

  it("moveNode moves a node into a sibling's children", () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'c', targetParentId: 'a', targetIndex: 1 });
    });

    const tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'b']);
    expect(childIds(tree.children?.[0])).toEqual(['a1', 'c']);
  });

  it('moveNode moves a node out to its grandparent', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'a1', targetParentId: 'root', targetIndex: 1 });
    });

    const tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['a', 'a1', 'b', 'c']);
    expect(childIds(tree.children?.[0])).toEqual([]);
  });

  it('moveNode rejects moving the root node', () => {
    const { result } = renderNodeTree();
    const previousTree = result.current.selectors.selectTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'root', targetParentId: 'a', targetIndex: 0 });
    });

    expect(result.current.selectors.selectTree()).toEqual(previousTree);
  });

  it('moveNode rejects moving a node into its own descendant', () => {
    const { result } = renderNodeTree();
    const previousTree = result.current.selectors.selectTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'a', targetParentId: 'a1', targetIndex: 0 });
    });

    expect(result.current.selectors.selectTree()).toEqual(previousTree);
  });

  it('moveNode rejects using the moved node as its own parent', () => {
    const { result } = renderNodeTree();
    const previousTree = result.current.selectors.selectTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'a', targetParentId: 'a', targetIndex: 0 });
    });

    expect(result.current.selectors.selectTree()).toEqual(previousTree);
  });

  it('moveNode preserves focusedNodeId when the focused node is moved', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'setFocus', nodeId: 'c' });
      result.current.dispatch({ type: 'moveNode', id: 'c', targetParentId: 'a', targetIndex: 0 });
    });

    expect(result.current.state.focusedNodeId).toBe('c');
  });

  it('moveNode shifts adjacent siblings correctly after detaching the source', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'moveNode', id: 'a', targetParentId: 'root', targetIndex: 2 });
    });

    expect(childIds(result.current.selectors.selectTree())).toEqual(['b', 'c', 'a']);
  });

  it('toggles and persists collapsed state', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({ type: 'toggleCollapse', id: 'a' });
    });

    expect(result.current.state.nodes.a.collapsed).toBe(true);
    expect(result.current.selectors.selectTree().children?.[0].collapsed).toBe(true);
  });

  it('adds and removes media items', () => {
    const { result } = renderNodeTree();

    act(() => {
      result.current.dispatch({
        type: 'addMedia',
        id: 'a',
        media: { id: 'media-1', type: 'url', url: 'https://example.com', caption: 'Example' },
      });
    });

    expect(result.current.state.nodes.a.media).toHaveLength(1);

    act(() => {
      result.current.dispatch({ type: 'removeMedia', id: 'a', mediaId: 'media-1' });
    });

    expect(result.current.state.nodes.a.media).toBeUndefined();
  });

  it('selectFlat skips collapsed descendants', () => {
    const state = flatten({
      id: 'root',
      children: [
        {
          id: 'parent',
          collapsed: true,
          children: [{ id: 'hidden-child' }],
        },
      ],
    });

    expect(selectFlat(state)).toEqual([
      { id: 'root', depth: 0, hasChildren: true, isCollapsed: false },
      { id: 'parent', depth: 1, hasChildren: true, isCollapsed: true },
    ]);
  });

  it('selectAncestorIds returns parent to root order', () => {
    const state = flatten(makeTree());

    expect(selectAncestorIds(state, 'a1')).toEqual(['a', 'root']);
  });

  it('serializes the normalized state back to a nested tree', () => {
    const state = flatten(makeTree());

    expect(selectTree(state)).toEqual(makeTree());
  });

  it('liftRootContent prepends the lifted preamble before existing root children', () => {
    // markdownToNodeTree emits "preamble paragraph + heading children" when
    // a doc starts with text before its first heading. liftRootContent has
    // to insert the lifted child BEFORE the existing children so the
    // preamble keeps its reading order.
    const { result } = renderNodeTree({
      id: 'root',
      header: 'Preamble',
      children: [{ id: 'existing-child', header: 'Existing' }],
    });

    act(() => {
      result.current.dispatch({ type: 'liftRootContent', childId: 'lifted' });
    });

    const tree = result.current.selectors.selectTree();
    expect(childIds(tree)).toEqual(['lifted', 'existing-child']);
    // Root becomes a pure structural wrapper — header is gone.
    expect(tree.header).toBeUndefined();
    expect(tree.text).toBeUndefined();
    // New child carries the lifted header.
    expect(result.current.state.nodes.lifted).toMatchObject({
      id: 'lifted',
      header: 'Preamble',
    });
    // Existing child is untouched.
    expect(result.current.state.nodes['existing-child']).toMatchObject({
      id: 'existing-child',
      header: 'Existing',
    });
    expect(result.current.state.focusedNodeId).toBe('lifted');
  });

  it('rejects updates that exceed the hard serialized size budget', () => {
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderNodeTree({ id: 'root', text: 'small' });
    const previousTree = result.current.selectors.selectTree();

    act(() => {
      result.current.dispatch({
        type: 'updateText',
        id: 'root',
        text: 'x'.repeat(900_001),
      });
    });

    expect(result.current.selectors.selectTree()).toEqual(previousTree);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rejected'));
    warnSpy.mockRestore();
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
  });
});
