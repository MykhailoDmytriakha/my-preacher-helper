import { render } from '@testing-library/react';
import React from 'react';

import { LocalizedToaster } from '@/components/LocalizedToaster';

describe('the notification area', () => {
  it('is named in the interface language, not by the library default', () => {
    const { container } = render(<LocalizedToaster />);
    // The global i18n mock returns the key; sonner appends its hotkey hint.
    expect(container.querySelector('section')?.getAttribute('aria-label')).toMatch(/^common\.notifications /);
  });
});
