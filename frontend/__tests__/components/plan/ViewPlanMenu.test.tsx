import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ViewPlanMenu from '@/components/plan/ViewPlanMenu';

let translationOverrides: Record<string, string | undefined> = {};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'plan.viewPlan': 'View Plan',
        'plan.pageTitle': 'Plan',
        'plan.viewFullPlan': 'Full Plan',
        'plan.preachButton': 'Preach',
        'plan.noContent': 'No content',
        'sections.introduction': 'Introduction',
        'sections.main': 'Main',
        'sections.conclusion': 'Conclusion',
        'actions.close': 'Close',
      };
      if (Object.prototype.hasOwnProperty.call(translationOverrides, key)) {
        return translationOverrides[key] ?? '';
      }
      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

describe('ViewPlanMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    translationOverrides = {};
  });

  function renderMenu(props?: Partial<React.ComponentProps<typeof ViewPlanMenu>>) {
    const onRequestPlanOverlay = jest.fn();
    const onRequestPreachingMode = jest.fn();
    const onStartPreachingMode = jest.fn();

    const Wrapper = () => {
      const [showSectionMenu, setShowSectionMenu] = React.useState(false);
      const sectionMenuRef = React.useRef<HTMLDivElement>(null);

      return (
        <ViewPlanMenu
          sermonId="sermon-1"
          combinedPlan={{
            introduction: 'Intro **markdown**',
            main: 'Main content',
            conclusion: '',
          }}
          sectionMenuRef={sectionMenuRef}
          showSectionMenu={showSectionMenu}
          setShowSectionMenu={setShowSectionMenu}
          onRequestPlanOverlay={onRequestPlanOverlay}
          onRequestPreachingMode={onRequestPreachingMode}
          onStartPreachingMode={onStartPreachingMode}
          {...props}
        />
      );
    };

    const utils = render(<Wrapper />);

    return {
      ...utils,
      onRequestPlanOverlay,
      onRequestPreachingMode,
      onStartPreachingMode,
    };
  }

  it('opens a section modal with rendered markdown and closes it', async () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /introduction/i }));

    expect(await screen.findByText('Plan - Introduction')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Intro **markdown**');

    fireEvent.click(screen.getByTitle('Close'));

    await waitFor(() => {
      expect(screen.queryByText('Plan - Introduction')).not.toBeInTheDocument();
    });
  });

  it('falls back to no-content text for empty sections and opens the full plan overlay', async () => {
    const { onRequestPlanOverlay } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /conclusion/i }));

    expect(await screen.findByText('No content')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /full plan/i }));

    expect(onRequestPlanOverlay).toHaveBeenCalledTimes(1);
  });

  it('prefers onStartPreachingMode over other preaching handlers', () => {
    const { onRequestPreachingMode, onStartPreachingMode } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /preach/i }));

    expect(onStartPreachingMode).toHaveBeenCalledTimes(1);
    expect(onRequestPreachingMode).not.toHaveBeenCalled();
  });

  it('uses fallback labels, opens the main section, and falls back to onRequestPreachingMode', async () => {
    translationOverrides = {
      'plan.viewPlan': '',
      'plan.viewFullPlan': '',
      'plan.preachButton': '',
      'actions.close': '',
    };

    const { onRequestPreachingMode } = renderMenu({ onStartPreachingMode: undefined });

    expect(screen.getByRole('button', { name: 'View Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preach' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Plan' }));
    expect(screen.getByRole('button', { name: 'Full Plan' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Main' }));
    expect(await screen.findByText('Plan - Main')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preach' }));
    expect(onRequestPreachingMode).toHaveBeenCalledTimes(1);
  });

  it('falls back to window navigation when no preaching callbacks are provided', () => {
    const originalLocation = window.location;
    delete (window as Partial<Window>).location;
    (window as Window & { location: { href: string } }).location = { href: 'http://localhost/' } as any;

    renderMenu({ onStartPreachingMode: undefined, onRequestPreachingMode: undefined });

    fireEvent.click(screen.getByRole('button', { name: /preach/i }));

    expect(window.location.href).toBe('/sermons/sermon-1/plan?planView=preaching');
    window.location = originalLocation;
  });
});
