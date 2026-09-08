import { fireEvent, render, screen } from '@testing-library/react';

import { ThoughtTagsField } from '@/components/thought/ThoughtTagsField';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { tag?: string }) => options?.tag ? `${key}:${options.tag}` : key }) }));

it('uses canonical structure styling, custom colors and explicit translated names while retaining removal indexes', () => {
  const remove = jest.fn();
  const add = jest.fn();
  render(<ThoughtTagsField tags={['intro', 'Unlisted']} allowedTags={[{ name: 'intro', color: '#ff00ff' }]} availableTags={[{ name: 'Custom', color: '#336699', translationKey: 'custom.label' }]} onAddTag={add} onRemoveTag={remove} />);
  const intro = screen.getByRole('button', { name: 'thought.removeTagAria:tags.introduction' });
  expect(intro).not.toHaveStyle({ backgroundColor: '#ff00ff' });
  expect(intro.querySelector('svg')).toBeInTheDocument();
  const custom = screen.getByRole('button', { name: 'thought.addTagAria:custom.label' });
  expect(custom).toHaveStyle({ backgroundColor: '#336699' });
  fireEvent.click(custom);
  fireEvent.click(screen.getByRole('button', { name: 'thought.removeTagAria:Unlisted' }));
  expect(add).toHaveBeenCalledWith('Custom');
  expect(remove).toHaveBeenCalledWith(1);
});

it('makes every tag inert when its editor is read-only', () => {
  const action = jest.fn();
  render(<ThoughtTagsField tags={['Selected']} allowedTags={[]} availableTags={[{ name: 'Available' }]} onAddTag={action} onRemoveTag={action} disabled />);
  expect(screen.queryByRole('button')).toBeNull();
  for (const name of ['thought.removeTagAria:Selected', 'thought.addTagAria:Available']) {
    const chip = screen.getByLabelText(name);
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    expect(chip).not.toHaveAttribute('tabindex');
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: 'Enter' });
  }
  expect(action).not.toHaveBeenCalled();
});
