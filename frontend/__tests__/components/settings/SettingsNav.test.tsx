import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SettingsNav from '@components/settings/SettingsNav';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock
  }),
}));

jest.mock('next/link', () => ({ children, href, ...rest }: any) => (
  <a href={href} {...rest}>{children}</a>
));

/**
 * A SECTION YOU CANNOT LINK TO IS NOT A SECTION, IT IS A MODE.
 *
 * These were buttons setting a piece of state, so "open plan settings" from the usage
 * tooltip could only reach the settings screen and never the section it meant. Each item
 * carries its own address now, which is also what makes the back button and a new tab work.
 */
describe('SettingsNav', () => {
  it('gives every section its own address', () => {
    render(<SettingsNav activeSection="user" />);

    expect(screen.getByRole('link', { name: 'settings.userSettings' })).toHaveAttribute('href', '/settings/user');
    expect(screen.getByRole('link', { name: 'settings.nav.aiModels' })).toHaveAttribute('href', '/settings/limits');
    expect(screen.getByRole('link', { name: 'settings.manageTags' })).toHaveAttribute('href', '/settings/tags');
    expect(screen.getByRole('link', { name: 'settings.planTemplates' })).toHaveAttribute('href', '/settings/templates');
  });

  it.each([
    ['user', 'settings.userSettings', 'settings.manageTags'],
    ['tags', 'settings.manageTags', 'settings.userSettings'],
    ['limits', 'settings.nav.aiModels', 'settings.userSettings'],
    ['templates', 'settings.planTemplates', 'settings.userSettings'],
  ])('marks %s as the page you are on', (section, currentLabel, otherLabel) => {
    render(<SettingsNav activeSection={section as never} />);

    const current = screen.getByRole('link', { name: currentLabel });
    const other = screen.getByRole('link', { name: otherLabel });

    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('bg-blue-600');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).toHaveClass('hover:bg-gray-100');
  });

  it('offers the way into the admin screen only to an administrator', () => {
    const { rerender } = render(<SettingsNav activeSection="user" />);
    expect(screen.queryByRole('link', { name: 'settings.admin.goToAdmin' })).not.toBeInTheDocument();

    rerender(<SettingsNav activeSection="user" isAdmin />);
    expect(screen.getByRole('link', { name: 'settings.admin.goToAdmin' })).toHaveAttribute('href', '/admin');
  });
});
