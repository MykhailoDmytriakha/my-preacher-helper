'use client';

import { BookOpenIcon, ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/solid';
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import FeedbackModal from "@/components/navigation/FeedbackModal";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import MobileMenu from "@/components/navigation/MobileMenu";
import { primaryNavItems, isNavItemActive } from "@/components/navigation/navConfig";
import UserProfileDropdown from "@/components/navigation/UserProfileDropdown";
import {
  UsageGraceController,
  UsageGraceIndicator,
  type UsageGraceViewModel,
} from '@/components/usage/UsageGraceIndicator';
import { useAuth } from "@/hooks/useAuth";
import { useFeedback } from "@/hooks/useFeedback";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrepModeAccess } from "@/hooks/usePrepModeAccess";
import useSermon, { sermonIsMissing } from '@/hooks/useSermon';
import { useShellPathname } from "@/hooks/useShellPathname";
import { debugLog } from "@/utils/debugMode";
import { getNavItemTheme } from "@/utils/themeColors";
import { isConductRoute } from '@/utils/usageGrace';

import { AppUpdateButton } from "./AppUpdateButton";
import ModeToggle, { type SermonMode } from "./ModeToggle";
import { OfflineIndicator } from "./OfflineIndicator";

/** The gap a word leaves behind on the bar when it is dropped. */
const BAR_GAP = 8;
/**
 * The room a state must have TO SPARE before the bar settles into it. It exists only to
 * absorb layout rounding — hiding a word does not always hand the zone back exactly the
 * width that word measured — so it is two pixels, not eight: a generous margin here costs a
 * whole rung. Measured live at 1280px with Russian labels, the labelled list fits with six
 * pixels left, and an eight-pixel margin threw the labels away for nothing.
 */
const FIT_SLACK = 2;

const parseSermonMode = (value: string | null | undefined): SermonMode | null => {
  if (value === 'prep' || value === 'classic' || value === 'raw') return value;
  return null;
};

const getSermonIdFromPathname = (pathname: string | null | undefined) => {
  const match = pathname?.match(/^\/sermons\/([^/]+)$/);
  return match?.[1] ?? null;
};

export default function DashboardNav() {
  const { t } = useTranslation();
  const { user, handleLogout } = useAuth();
  const isOnline = useOnlineStatus();
  const {
    showFeedbackModal,
    handleFeedbackClick,
    closeFeedbackModal,
    handleSubmitFeedback
  } = useFeedback();
  const { hasAccess: showWizardButton, loading: prepModeLoading } = usePrepModeAccess();
  debugLog('🔧 DashboardNav: showWizardButton:', showWizardButton, 'prepModeLoading:', prepModeLoading);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = useShellPathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navItems = useMemo(() => (
    primaryNavItems
      .map((item) => ({
        ...item,
        label: t(item.labelKey, { defaultValue: item.defaultLabel })
      }))
  ), [t]);
  const workspaceNavItems = navItems.filter((item) => item.key !== 'settings');

  /**
   * THE BAR MEASURES ITSELF INSTEAD OF GUESSING AT A BREAKPOINT.
   *
   * The labels used to appear at `xl` and the list was clipped by `overflow-hidden`, so on
   * every width where the labelled list was wider than the space left over — a long locale,
   * a wide language switcher, one more section — the LAST item (the calendar) was simply cut
   * off the right edge. Cut off, not hidden: no menu held it, and on a desktop there is no
   * hamburger, so the section was unreachable and nothing on screen said so.
   *
   * A breakpoint cannot know this, because what is scarce is not the WINDOW but the space
   * left after the logo and the right-hand controls, and the labels are as long as the
   * translation makes them. So the list reports the width it needs (`scrollWidth` counts the
   * overflow it cannot show), the zone reports the width it has, and the labels drop when
   * they do not fit. The needed width is remembered from the labelled render: dropping the
   * labels shrinks the list, and re-measuring it then would flip the decision back and
   * forth for ever.
   */
  const navZoneRef = useRef<HTMLDivElement | null>(null);
  const navListRef = useRef<HTMLUListElement | null>(null);
  const wordmarkRef = useRef<HTMLSpanElement | null>(null);
  const feedbackLabelRef = useRef<HTMLSpanElement | null>(null);
  const labelledWidthRef = useRef<number | null>(null);
  const wordmarkWidthRef = useRef(0);
  const feedbackLabelWidthRef = useRef(0);
  const [navCompact, setNavCompact] = useState(false);
  const [navTight, setNavTight] = useState(false);
  const [showWordmark, setShowWordmark] = useState(true);
  const [showFeedbackLabel, setShowFeedbackLabel] = useState(true);
  /** Set during render: only a list that is actually showing labels can report their width. */
  const navLabelsShownRef = useRef(true);
  const navTightShownRef = useRef(false);
  const wordmarkShownRef = useRef(true);
  const feedbackLabelShownRef = useRef(true);
  /** The width the labelled list needs once the row is squeezed; taken from a tight render. */
  const tightWidthRef = useRef<number | null>(null);

  const measureNavFit = useCallback(() => {
    const zone = navZoneRef.current;
    const list = navListRef.current;
    if (!zone || !list) return;
    if (navLabelsShownRef.current) {
      // Two widths for the same labels: the roomy row and the squeezed one. Each is taken only
      // from a render that is actually in that state, and both are remembered — so the ladder
      // below stays a pure function of the window and cannot flip between two rungs for ever.
      if (navTightShownRef.current) tightWidthRef.current = list.scrollWidth;
      else labelledWidthRef.current = list.scrollWidth;
    }
    // Plus the gap each one leaves behind when it goes.
    if (wordmarkShownRef.current && wordmarkRef.current) {
      wordmarkWidthRef.current = wordmarkRef.current.offsetWidth + BAR_GAP;
    }
    if (feedbackLabelShownRef.current && feedbackLabelRef.current) {
      feedbackLabelWidthRef.current = feedbackLabelRef.current.offsetWidth + BAR_GAP;
    }
    const needed = labelledWidthRef.current;
    const available = zone.clientWidth;
    // Zero means "not laid out yet" (a test renderer, a hidden tab): keep the labels.
    if (!available || !needed) return;

    /*
      WHAT GIVES WAY FIRST IS A DECISION, NOT AN ACCIDENT.
      Two words on the bar are worth less than the section names, and they go in this order:
      the app's own name (its square icon still says what the app is, and the person reading
      it is already inside the app), then the word on the feedback button (the speech bubble
      is unmistakable). Only when neither is enough do the sections collapse into icons — and
      then both words come back, because the icon row leaves room for them.

      `base` is the width the list would have if EVERY word were on the bar, so the ladder is
      a pure function of the window and cannot oscillate: giving a word back never changes
      the rung the next measurement lands on.
    */
    const wordmark = wordmarkWidthRef.current;
    const feedbackLabel = feedbackLabelWidthRef.current;
    const base =
      available -
      (wordmarkShownRef.current ? 0 : wordmark) -
      (feedbackLabelShownRef.current ? 0 : feedbackLabel);
    // A rung is only taken when it fits with a little room to spare, so the bar cannot sit
    // exactly on a boundary and flip back and forth for ever.
    const fits = (room: number) => needed + FIT_SLACK <= room;

    const bare = base + wordmark + feedbackLabel;
    /*
      THE ROW GIVES WAY BEFORE THE WORDS DO.
      One rung before the names disappear: the same labels with less air around them. On a
      tablet held sideways this is the whole difference between seven words and seven icons —
      measured, the squeeze is worth about fifty pixels, and about forty is what was missing.
      Until a tight render has been measured its width is unknown, so that rung is TRIED: the
      next pass measures it and either keeps it or falls through to icons, once and for good.
    */
    const tight = tightWidthRef.current;
    const tightFits = tight === null || tight + FIT_SLACK <= bare;

    if (fits(base)) {
      setNavCompact(false);
      setNavTight(false);
      setShowWordmark(true);
      setShowFeedbackLabel(true);
    } else if (fits(base + wordmark)) {
      setNavCompact(false);
      setNavTight(false);
      setShowWordmark(false);
      setShowFeedbackLabel(true);
    } else if (fits(bare)) {
      setNavCompact(false);
      setNavTight(false);
      setShowWordmark(false);
      setShowFeedbackLabel(false);
    } else if (tightFits) {
      setNavCompact(false);
      setNavTight(true);
      setShowWordmark(false);
      setShowFeedbackLabel(false);
    } else {
      setNavCompact(true);
      setNavTight(false);
      setShowWordmark(true);
      setShowFeedbackLabel(true);
    }
  }, []);

  /**
   * Forget every remembered width and go back to the widest state, so the next measuring
   * pass can take a fresh one. Needed whenever the labels themselves change size: a new
   * locale, and — the case that is easy to miss — web fonts finishing their swap. A cached
   * number taken in the fallback font is too small, and nothing else would ever re-take it.
   */
  const resetNavFit = useCallback(() => {
    labelledWidthRef.current = null;
    tightWidthRef.current = null;
    wordmarkWidthRef.current = 0;
    feedbackLabelWidthRef.current = 0;
    setNavCompact(false);
    setNavTight(false);
    setShowWordmark(true);
    setShowFeedbackLabel(true);
  }, []);

  /**
   * A new locale means new label widths, so the remembered number is thrown away.
   *
   * Keyed on the LABELS THEMSELVES, never on the `navItems` array: that array is rebuilt on
   * every render (it is memoised on `t`, and i18next hands out a fresh `t` each pass), so an
   * effect keyed on its identity re-ran, reset the state, re-rendered, and ran again —
   * "Maximum update depth exceeded" on the very first paint.
   */
  const navSignature = useMemo(() => navItems.map((item) => item.label).join('|'), [navItems]);

  useLayoutEffect(() => {
    resetNavFit();
  }, [navSignature, resetNavFit]);

  /**
   * MEASURED AFTER EVERY RENDER, deliberately without a dependency list.
   *
   * The decision is a pure function of widths that do not depend on the decision itself
   * (`base` normalises away whatever is currently hidden), so re-running it converges: the
   * second pass computes the same answer, `setState` sees identical values and React stops.
   * Guarding it with dependencies is what broke it — after the reset above the bar rendered
   * its labels again and nothing re-measured them, so a language change from the compact
   * state could leave a labelled list wider than its own zone.
   */
  useLayoutEffect(() => {
    measureNavFit();
  });

  useLayoutEffect(() => {
    const zone = navZoneRef.current;
    if (!zone || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureNavFit());
    observer.observe(zone);
    return () => observer.disconnect();
  }, [measureNavFit]);

  /**
   * Web fonts land after the first measurement and make every label wider. Nothing else
   * notices: the zone keeps its width, so the observer stays silent and the remembered
   * number stays too small.
   */
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.ready) return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled) resetNavFit();
    }).catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [resetNavFit]);

  const settingsNavItem = navItems.find((item) => item.key === 'settings');
  const SettingsIcon = settingsNavItem?.icon;
  const currentNavItem = navItems.find((item) => isNavItemActive(pathname, item.matchers));
  const settingsActive = settingsNavItem ? isNavItemActive(pathname, settingsNavItem.matchers) : false;

  // Function to close mobile menu when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Mode toggle visibility and handlers (sermon detail only)
  const isSermonRoot = /^\/sermons\/[^/]+$/.test(pathname || "");
  const sermonIdForMode = getSermonIdFromPathname(pathname);
  // Check if we're on any sermon-related page
  const isSermonRelated = /^\/sermons\//.test(pathname || "") || pathname === '/structure';
  /**
   * Icons alone, no labels: either because a sermon page needs its width for the mode
   * toggle, or because the measurement above says the labels do not fit.
   */
  const feedbackLabelText = (t('feedback.button') || 'Feedback') as string;
  const iconOnlyNav = isSermonRelated || navCompact;
  navLabelsShownRef.current = !iconOnlyNav;
  navTightShownRef.current = navTight;
  wordmarkShownRef.current = showWordmark;
  feedbackLabelShownRef.current = showFeedbackLabel;
  const [savedMode, setSavedMode] = useState<SermonMode>('classic');

  // Get current mode directly from URL params for immediate response
  const modeFromUrl = parseSermonMode(searchParams?.get('mode'));
  const currentMode = modeFromUrl ?? savedMode;

  useEffect(() => {
    if (!isSermonRoot || !sermonIdForMode || typeof window === 'undefined') {
      setSavedMode('classic');
      return;
    }

    const storedMode = parseSermonMode(localStorage.getItem(`sermon-${sermonIdForMode}-mode`));
    setSavedMode(storedMode ?? 'classic');
  }, [isSermonRoot, sermonIdForMode]);

  const setMode = (mode: SermonMode) => {
    try {
      if (mode === 'prep' && !showWizardButton) return;

      // Check if we're trying to switch to the same mode
      if (mode === currentMode) {
        debugLog('Already in mode', mode);
        return;
      }

      debugLog('Switching sermon mode', { from: currentMode, to: mode });

      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('mode', mode);
      if (sermonIdForMode && typeof window !== 'undefined') {
        localStorage.setItem(`sermon-${sermonIdForMode}-mode`, mode);
      }
      setSavedMode(mode);
      const query = params.toString();

      // Use push for better navigation
      const newUrl = `${pathname}${query ? `?${query}` : ''}`;
      debugLog('Navigating to sermon mode URL', newUrl);

      router.push(newUrl, { scroll: false });

      debugLog('Successfully switched sermon mode', mode);
    } catch (error) {
      console.error('Error switching mode:', error);
    }
  };

  // Handle submitting feedback with user info
  const submitFeedbackWithUser = async (text: string, type: string, images: string[]) => {
    return handleSubmitFeedback(text, type, images, user?.uid || 'anonymous');
  };

  /**
   * THE MODE SWITCHER BELONGS TO A SERMON, so it disappears when there is none.
   *
   * On the "sermon not found or unavailable" screen — a deleted sermon opened from a link, a
   * stale bookmark, someone else's id — the three buttons stayed on the bar and switched
   * modes of nothing. The answer comes from the SAME query the page reads (React Query
   * dedupes: two observers, one fetch), so the bar and the screen can never disagree.
   *
   * `''` on every other route keeps the read disabled: the hook does nothing for an empty id.
   */
  const sermonForNav = useSermon(isSermonRoot ? (sermonIdForMode ?? '') : '');
  const sermonMissing = isSermonRoot && sermonIsMissing(sermonForNav.sermon, sermonForNav);

  const modeToggle = isSermonRoot && !sermonMissing ? (
    <ModeToggle
      compactBreakpoint={1024}
      currentMode={currentMode}
      onSetMode={setMode}
      canUsePrep={!prepModeLoading && showWizardButton}
      tSwitchToClassic={t('wizard.switchToClassic') as string}
      tSwitchToPrep={t('wizard.switchToPrepBeta') as string}
      tSwitchToRaw={t('wizard.switchToRaw') as string}
      tPrepLabel={t('wizard.modePrep') as string}
      tClassicLabel={t('wizard.modeClassic') as string}
      tRawLabel={t('wizard.modeRaw') as string}
    />
  ) : null;

  const renderNavigation = (usageGrace: UsageGraceViewModel | null) => (
    <nav className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-950/95">
      <div className={`relative w-full px-4 sm:px-6 lg:px-8 ${modeToggle ? 'lg:grid lg:h-16 lg:grid-cols-[max-content_minmax(0,1fr)_max-content] lg:items-center lg:gap-4' : ''}`}>
        {/* Desktop Layout */}
        <div className={modeToggle ? 'hidden lg:contents' : 'hidden lg:flex h-16 items-center gap-4 relative'}>
          {/*
            Left: Logo — and NOT on sermon pages.
            It is a link to the dashboard, which the very first icon of the nav
            already is, so on the one screen where width is scarce it costs room
            and gives a second way to do the same thing. The wordmark says what
            the app is; a person editing a sermon inside it already knows.
          */}
          {!isSermonRelated && (
            <Link
              href="/dashboard"
              prefetch={isOnline}
              className="group flex shrink-0 items-center gap-2 rounded-full pr-2 text-base font-semibold text-gray-950 transition hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-300"
              aria-label={t('navigation.dashboard') as string}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-950/10 transition group-hover:shadow-blue-500/20 dark:from-blue-500 dark:to-indigo-500">
                <BookOpenIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              {showWordmark && (
                <span ref={wordmarkRef} className="hidden whitespace-nowrap lg:inline">
                  {t('navigation.appName', { defaultValue: 'My Preacher Helper' })}
                </span>
              )}
            </Link>
          )}

          {/*
            ONE NAVIGATION, TWO SIZES — never a different navigation.
            Sermon pages used to hide the sections behind a "Navigation" dropdown,
            so leaving a sermon cost two clicks and a guess, while every other page
            kept them one click away. What is actually scarce there is width: the
            mode toggle sits in the middle of the bar. So the labels go and the
            icons stay out in the open — the accessible name still carries the
            label, and `title` gives it back on hover.
          */}
          <div ref={navZoneRef} className={`min-w-0 flex-1 ${modeToggle ? 'lg:col-start-1 lg:row-start-1' : ''}`}>
          <ul
            ref={navListRef}
            /*
              `overflow-x-auto`, never `overflow-hidden`. The measurement above should keep
              the list inside its zone, but every measurement has a moment when it is not
              true yet — the server's first paint, a cold start where hydration is slow or
              never happens, a font that lands late. Clipping turns that moment into a
              section that does not exist: on a desktop there is no hamburger to reach it
              from. Scrolling keeps it reachable while the bar catches up. The scrollbar
              itself is hidden — when the measurement is right, there is nothing to scroll.
            */
            className={`flex w-fit max-w-full items-center ${navTight ? 'gap-0.5' : 'gap-1'} overflow-x-auto rounded-full border border-gray-200/70 bg-gray-50/85 p-1 shadow-inner shadow-white/60 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-gray-700/60 dark:bg-gray-900/70 dark:shadow-black/20`}
            aria-label={t('navigation.primary', { defaultValue: 'Primary navigation' }) ?? 'Primary navigation'}
          >
            {workspaceNavItems.map((item) => {
              const active = isNavItemActive(pathname, item.matchers);
              const Icon = item.icon;
              const themeClasses = getNavItemTheme(item.theme);
              return (
                <li key={item.key} className="shrink-0">
                  <Link
                    href={item.href}
                    prefetch={isOnline}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    title={iconOnlyNav ? item.label : undefined}
                    /*
                      ONE HEIGHT ACROSS THE WHOLE BAR: every target in the header is
                      36px, so every capsule around one measures 46px (36 + p-1 on
                      both sides + the border) and everything shares a centre line.
                      Before this the bar mixed 32, 36, 40 and 42px — near-misses
                      the eye catches without being able to name. Only the shape
                      adapts to the page: labelled pills where there is room, square
                      icons on sermon pages where there is not.
                    */
                    className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border text-sm font-medium transition ${iconOnlyNav
                      ? 'w-9'
                      : navTight
                        ? 'gap-1 px-1.5'
                        : 'gap-1.5 px-2.5'
                      } ${active
                        ? themeClasses.pill
                        : `border-transparent text-gray-600 dark:text-gray-300 ${themeClasses.hover}`
                      }`}
                  >
                    <Icon className={`shrink-0 ${iconOnlyNav ? 'h-[18px] w-[18px]' : 'h-4 w-4'}`} aria-hidden="true" />
                    {!iconOnlyNav && (
                      <>
                        <span suppressHydrationWarning={true}>{item.label}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          </div>

          {/* Right: Desktop controls */}
          <div className={`flex shrink-0 items-center gap-2 rounded-full border border-gray-200/70 bg-gray-50/85 px-2 py-1 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70 ${modeToggle ? 'lg:col-start-3 lg:row-start-1' : ''}`}>
            {usageGrace && <UsageGraceIndicator model={usageGrace} placement="desktop" />}
            <AppUpdateButton />
            <OfflineIndicator />
            {/* Feedback button for desktop */}
            <button
              onClick={handleFeedbackClick}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition-all hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:from-blue-500 dark:to-indigo-500 dark:hover:from-blue-400 dark:hover:to-indigo-400 dark:focus:ring-offset-gray-950"
              // The word beside the bubble is the first thing this bar gives up, so the name has
              // to live on the button itself — and in the reader's language, not in English.
              aria-label={feedbackLabelText}
              title={feedbackLabelText}
            >
              <ChatBubbleLeftEllipsisIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {showFeedbackLabel && (
                <span ref={feedbackLabelRef} className="hidden lg:inline" suppressHydrationWarning={true}>
                  {feedbackLabelText}
                </span>
              )}
            </button>
            {settingsNavItem && SettingsIcon && (
              <Link
                href={settingsNavItem.href}
                prefetch={isOnline}
                aria-current={settingsActive ? 'page' : undefined}
                aria-label={settingsNavItem.label}
                title={settingsNavItem.label}
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${settingsActive
                  ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-white hover:text-gray-950 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white'
                  }`}
              >
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <div className="language-container">
              <LanguageSwitcher />
            </div>
            <UserProfileDropdown
              user={user}
              onLogout={handleLogout}
            />
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden py-3">
          <div data-testid="mobile-navigation-controls" className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
            <button
              type="button"
              onClick={handleFeedbackClick}
              className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-gray-100"
              aria-label={t('feedback.button', { defaultValue: 'Feedback' })}
            >
              <ChatBubbleLeftEllipsisIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-tight">{t('navigation.feedbackShort', { defaultValue: 'Feedback' })}</span>
            </button>

            {modeToggle ? <div aria-hidden="true" /> : <Link
              href={currentNavItem?.href || "/dashboard"}
              prefetch={isOnline}
              className="min-w-0 break-words bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-center text-lg font-bold leading-tight text-transparent"
            >
              <span suppressHydrationWarning={true}>
                {currentNavItem?.label || t('navigation.dashboard')}
              </span>
            </Link>}

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t('navigation.openMenu', { defaultValue: 'Open menu' })}
              aria-haspopup="dialog"
              aria-expanded={mobileMenuOpen}
              className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-gray-100"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={mobileMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
              <span className="text-[10px] font-medium leading-tight">{t('navigation.menu', { defaultValue: 'Menu' })}</span>
            </button>
          </div>
          <div className="flex justify-end gap-2 empty:hidden [&_button]:min-h-12 [&_button]:min-w-12">
            {usageGrace && <UsageGraceIndicator model={usageGrace} placement="mobile" />}
            <AppUpdateButton />
            <OfflineIndicator />
          </div>
        </div>
        {modeToggle && (
          <div className="absolute left-[4.5rem] right-[4.5rem] top-3 flex h-12 min-w-0 items-center justify-center sm:left-20 sm:right-20 lg:static lg:col-start-2 lg:row-start-1 lg:h-auto">
            {modeToggle}
          </div>
        )}
      </div>

      {/* Mobile menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onLogout={handleLogout}
        user={user}
        pathname={pathname || ''}
        onNavigate={() => setMobileMenuOpen(false)}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedbackModal}
        onClose={closeFeedbackModal}
        onSubmit={submitFeedbackWithUser}
      />
    </nav>
  );

  if (isConductRoute(pathname)) return renderNavigation(null);

  return (
    <UsageGraceController user={user} devUsageParam={searchParams?.get('devUsage')}>
      {renderNavigation}
    </UsageGraceController>
  );
}

// Mode toggle extracted to separate component for testability (see ModeToggle.tsx)
