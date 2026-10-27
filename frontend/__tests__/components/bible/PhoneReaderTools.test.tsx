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

it('one floating button opens the existing vertical tools and palette, reflects the active tool, and T opens text with its legend and settings', async () => {
  render(<Tools />);
  const trigger = screen.getByRole('button', { name: 'bible.toolsAndText' });
  expect(trigger).toHaveClass('h-14', 'w-14');
  expect(trigger.parentElement).toHaveClass('bottom-[calc(1.5rem+env(safe-area-inset-bottom))]');
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  await userEvent.click(trigger);
  const toolbar = screen.getByRole('toolbar', { name: 'bible.marks.toolbar' });
  expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
  await userEvent.click(within(toolbar).getByRole('button', { name: 'bible.marks.marker' }));
  expect(screen.getByRole('group', { name: 'bible.marks.colors' })).toBeInTheDocument();
  expect(trigger).toHaveClass('bg-indigo-600');
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  const card = screen.getByRole('group', { name: 'Text size' });
  expect(within(card).getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'bible.settingsLink' })).toHaveAttribute('href', '/settings/bible');
  expect(within(card).getByText('bible.marks.meaning.red')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('the same button, an outside press and Escape close the tools and restore focus', async () => {
  render(<Tools />);
  const trigger = screen.getByRole('button', { name: 'bible.toolsAndText' });
  await userEvent.click(trigger);
  await userEvent.click(trigger);
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  await userEvent.click(trigger);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('when marking is unavailable T opens the existing text controls directly', async () => {
  render(<Tools marking={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  expect(screen.getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
});

// Codex, 2026-10-26: after the text card Escape never put the tool away — the card leaves no toolbar to hear it.
it('Escape closes the open menu first and keeps the tool; with the menu closed it puts the tool away', async () => {
  render(<Tools />);
  const trigger = screen.getByRole('button', { name: 'bible.toolsAndText' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'bible.marks.marker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(trigger).toHaveClass('bg-indigo-600');
  await userEvent.keyboard('{Escape}');
  expect(trigger).not.toHaveClass('bg-indigo-600');
});


function NestedPickerTools() {
  const tool = useMarkTool();
  return <TextScaleProvider><PhoneReaderTools tool={tool}>
    {(returnFocusRef) => <TranslationPicker bible="rst" wide={false} returnFocusRef={returnFocusRef} onPick={() => {}} />}
  </PhoneReaderTools></TextScaleProvider>;
}

it('Escape closes a nested translation picker before putting the selected phone tool away', async () => {
  render(<NestedPickerTools />);
  const trigger = screen.getByRole('button', { name: 'bible.toolsAndText' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'bible.marks.marker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
  await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
  expect(await screen.findByRole('dialog', { name: 'bible.chooseTranslation' })).toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveClass('bg-indigo-600');
  await userEvent.keyboard('{Escape}');
  expect(trigger).not.toHaveClass('bg-indigo-600');
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
