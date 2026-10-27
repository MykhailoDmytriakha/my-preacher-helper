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
