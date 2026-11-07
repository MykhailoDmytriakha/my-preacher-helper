import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import PlanOverlayPortal from '@/(pages)/(private)/sermons/[id]/plan/PlanOverlayPortal';
import ViewPlanMenu from '@/components/plan/ViewPlanMenu';

import type { Sermon } from '@/models/models';

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
        'common.close': 'Close',
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

  it('holds keyboard focus in the full plan and returns it to the persistent menu button', () => {
    function Workspace() {
      const [menuOpen, setMenuOpen] = React.useState(false);
      const [overlayOpen, setOverlayOpen] = React.useState(false);
      const menu = React.useRef<HTMLDivElement>(null);
      const content = React.useRef<HTMLDivElement>(null);
      const returnFocusTo = React.useRef<HTMLElement | null>(null);
      const plan = { introduction: 'Intro', main: 'Main', conclusion: 'Closing' };
      const sermon = { id: 's1', title: 'Saved sermon', verse: '', thoughts: [] } as unknown as Sermon;
      return <>
        <ViewPlanMenu combinedPlan={plan} sectionMenuRef={menu} showSectionMenu={menuOpen} setShowSectionMenu={setMenuOpen}
          onRequestPlanOverlay={(opener?: HTMLElement) => { returnFocusTo.current = opener ?? null; setOverlayOpen(true); }} />
        <PlanOverlayPortal {...{ returnFocusTo }} isPlanOverlay={overlayOpen} sermon={sermon} combinedPlan={plan}
          t={key => key} timerState={null} isPreachingMode={false} noContentText="Empty" copyStatus="idle"
          planOverlayContentRef={content} onCopy={async () => undefined}
          onOpenPlanImmersive={() => undefined} onClosePlanView={() => setOverlayOpen(false)} />
      </>;
    }
    render(<Workspace />);
    const view = screen.getByRole('button', { name: 'View Plan' });
    fireEvent.click(view);
    const full = screen.getByRole('button', { name: 'Full Plan' });
    full.focus();
    fireEvent.click(full);
    const overlay = screen.getByTestId('sermon-plan-overlay');
    const buttons = overlay.querySelectorAll('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(overlay).not.toBeInTheDocument();
    expect(view).toHaveFocus();
  });

  it('dismisses a section with Escape', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /introduction/i }));
    expect(await screen.findByText('Plan - Introduction')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Plan - Introduction')).not.toBeInTheDocument();
    });
  });

  it('unmounts the open section when its menu leaves the page', async () => {
    const { unmount } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /main/i }));
    expect(await screen.findByText('Plan - Main')).toBeInTheDocument();

    unmount();

    expect(screen.queryByText('Plan - Main')).not.toBeInTheDocument();
  });

  it('holds the background, keeps Tab inside, and restores focus when dismissed', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: /view plan/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /main/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan - Main' });
    const close = screen.getByTitle('Close');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).not.toBe('hidden');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /introduction/i }));
    expect(await screen.findByRole('dialog', { name: 'Plan - Introduction' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

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

});
