import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TranslationPicker } from '@/components/bible/BiblePicker';
import { BibleSettingsLink } from '@/components/bible/BibleSettingsLink';
import { MarkToolbar } from '@/components/bible/marks/MarkToolbar';
import { MarkLegend } from '@/components/bible/marks/MarkLegend';
import { resetMarkToolForTests, useMarkTool } from '@/components/bible/marks/markTool';
import { PhoneReaderTools } from '@/components/bible/PhoneReaderTools';
import { TextScaleProvider } from '@/providers/TextScaleProvider';

function Tools({ marking = true }: { marking?: boolean }) {
  const tool = useMarkTool();
  return <TextScaleProvider><PhoneReaderTools tool={marking ? tool : null}><MarkLegend /><BibleSettingsLink /></PhoneReaderTools><button>Outside</button></TextScaleProvider>;
}

beforeEach(() => {
  localStorage.clear();
  resetMarkToolForTests();
});

// The owner's choice on the canvas, 2026-11-07 (K4): on a phone a column of tools at the right edge covered the end of every
// line while marking. The tools stand in a capsule at the bottom centre; the colours of the tool in hand float over it as dots.
it('the capsule holds the three tools and «T»; the tool in hand shows its colours as dots over it; «T» opens the text menu', async () => {
  render(<Tools />);
  const toolbar = screen.getByRole('toolbar', { name: 'bible.marks.toolbar' });
  expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
  expect(toolbar.parentElement).toHaveClass('bottom-[calc(1.5rem+env(safe-area-inset-bottom))]', 'inset-x-0', 'mx-auto');
  expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
  const marker = within(toolbar).getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(within(screen.getByRole('group', { name: 'bible.marks.colors' })).getAllByRole('button')).toHaveLength(5);
  // A colour is one tap, and the dots stay out while the tool is in hand.
  await userEvent.click(screen.getByRole('button', { name: 'bible.marks.meaning.green' }));
  expect(screen.getByRole('button', { name: 'bible.marks.meaning.green' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'bible.marks.colors' })).toBeInTheDocument();
  await userEvent.click(within(toolbar).getByRole('button', { name: 'bible.marks.pencil' }));
  expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'bible.marks.pencilColors' })).getAllByRole('button')).toHaveLength(6);
  const text = screen.getByRole('button', { name: 'Text size' });
  await userEvent.click(text);
  const card = screen.getByRole('group', { name: 'Text size' });
  expect(within(card).getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'bible.settingsLink' })).toHaveAttribute('href', '/settings/bible');
  expect(within(card).getByText('bible.marks.meaning.red')).toBeInTheDocument();
  // Under the open menu the dots step aside.
  expect(screen.queryByRole('group', { name: 'bible.marks.pencilColors' })).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(text).toHaveFocus();
});

it('«T» again and an outside press close the text menu and keep the tool', async () => {
  render(<Tools />);
  const marker = screen.getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  const text = screen.getByRole('button', { name: 'Text size' });
  await userEvent.click(text);
  await userEvent.click(text);
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  await userEvent.click(text);
  await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'bible.marks.colors' })).toBeInTheDocument();
});

it('when marking is unavailable T opens the existing text controls directly', async () => {
  render(<Tools marking={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  expect(screen.getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
});

// Codex, 2026-10-26: Escape closes the open menu first and keeps the tool; with the menu closed it puts the tool away.
it('Escape closes the open menu first and keeps the tool; with the menu closed it puts the tool away', async () => {
  render(<Tools />);
  const marker = screen.getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Escape}');
  expect(marker).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
});

// Codex, 2026-11-07: the marker taken, Shift+Tab onto a dot over the capsule, Escape — the dots hid with the focus inside them.
it('Escape on a dot puts the tool away and gives the focus back to that tool', async () => {
  render(<Tools />);
  const marker = screen.getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'bible.marks.meaning.blue' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(marker).toHaveAttribute('aria-pressed', 'false');
  expect(marker).toHaveFocus();
});


function NestedPickerTools() {
  const tool = useMarkTool();
  return <TextScaleProvider><PhoneReaderTools tool={tool}>
    {(returnFocusRef) => <TranslationPicker bible="rst" wide={false} returnFocusRef={returnFocusRef} onPick={() => {}} />}
  </PhoneReaderTools></TextScaleProvider>;
}

it('Escape closes a nested translation picker before putting the selected phone tool away', async () => {
  render(<NestedPickerTools />);
  const marker = screen.getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  const text = screen.getByRole('button', { name: 'Text size' });
  await userEvent.click(text);
  await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
  expect(await screen.findByRole('dialog', { name: 'bible.chooseTranslation' })).toBeInTheDocument();
  await waitFor(() => expect(text).toHaveAttribute('aria-expanded', 'false'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Escape}');
  expect(marker).toHaveAttribute('aria-pressed', 'false');
});


function WidePickerTools() {
  const tool = useMarkTool();
  return <><MarkToolbar tool={tool} /><TranslationPicker bible="rst" wide onPick={() => {}} /></>;
}

it('Escape closes a translation picker before putting the selected wide-reader tool away', async () => {
  render(<WidePickerTools />);
  const marker = screen.getByRole('button', { name: 'bible.marks.marker' });
  await userEvent.click(marker);
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
  expect(await screen.findByRole('dialog', { name: 'bible.chooseTranslation' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Escape}');
  expect(marker).toHaveAttribute('aria-pressed', 'false');
});
