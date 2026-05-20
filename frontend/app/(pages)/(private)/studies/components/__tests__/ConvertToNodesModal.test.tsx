import { fireEvent, render, screen } from '@testing-library/react';

import ConvertToNodesModal from '../ConvertToNodesModal';

import type { ContentNode } from '@/models/models';

jest.mock('@/components/studies/node/NodeTreeEditor', () => ({
  __esModule: true,
  default: ({ rootNode, readOnly }: { rootNode: ContentNode; readOnly?: boolean }) => (
    <div data-testid="node-tree-preview" data-readonly={String(readOnly)}>
      {rootNode.children?.map((child) => child.header).join(',') ?? rootNode.text}
    </div>
  ),
}));

describe('ConvertToNodesModal', () => {
  it('renders parsed node stats and a read-only preview', async () => {
    render(
      <ConvertToNodesModal
        open
        sourceContent={"# First\nBody\n## Child\nMore"}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Convert to nodes')).toBeInTheDocument();
    expect(screen.getByText('Will create 2 nodes across 2 nesting levels')).toBeInTheDocument();
    expect(screen.getByTestId('node-tree-preview')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('node-tree-preview')).toHaveTextContent('First');
  });

  it('passes the parsed root node to onConfirm', async () => {
    const onConfirm = jest.fn();

    render(
      <ConvertToNodesModal
        open
        sourceContent={"# First\nBody"}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      children: [{ header: 'First', text: 'Body' }],
    });
  });
});
