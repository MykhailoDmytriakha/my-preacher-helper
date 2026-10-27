import { screen, within } from '@testing-library/react';

import { ShellHeaderProvider, usePublishedShellHeader } from '@/components/navigation/shellHeader';

import { TextScaleProvider } from '@/providers/TextScaleProvider';

import type { ReactNode } from 'react';

/** Reader tests mount the same publishing boundary as the private workspace. */
function Header() {
  const header = usePublishedShellHeader();
  return <div data-testid="reader-shell-header">{header?.content}</div>;
}

export function ReaderShell({ children }: { children: ReactNode }) {
  return <TextScaleProvider><ShellHeaderProvider><Header />{children}</ShellHeaderProvider></TextScaleProvider>;
}

/** The actual visible place control: the wide chapter button or the phone's published pill. */
export const readerPlaceButton = () => screen.queryByRole('button', { name: 'bible.changeChapter' })
  ?? within(screen.getByTestId('reader-shell-header')).getByRole('button', { name: 'bible.navigate' });
