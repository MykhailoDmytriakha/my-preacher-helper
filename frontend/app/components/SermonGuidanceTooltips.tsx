import { InformationCircleIcon } from "@heroicons/react/24/outline";
import React from "react";

type PopoverAlignment = 'left' | 'right';

const useDismissablePopover = () => {
  const [open, setOpen] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      if (!popoverRef.current) return;
      const target = e.target as Node;
      if (!popoverRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('touchstart', onDocClick, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('touchstart', onDocClick, true);
    };
  }, [open]);

  return { open, setOpen, popoverRef };
};

type SectionKind = 'introduction' | 'conclusion';

const SECTION_CONFIG: Record<SectionKind, {
  baseKey: string;
  defaultTitle: string;
  defaultAriaLabel: string;
  items: Array<{ key: string; defaultValue: string }>;
}> = {
  introduction: {
    baseKey: 'structure.introductionInfo',
    defaultTitle: 'Introduction goals:',
    defaultAriaLabel: 'Introduction guidance',
    items: [
      { key: 'readScripture', defaultValue: 'Read the Scripture text' },
      { key: 'prayer', defaultValue: 'Call to prayer so the seed is sown and received with faith' },
      { key: 'engage', defaultValue: 'Engage listeners (connect the theme to their needs)' },
      { key: 'prepare', defaultValue: 'Prepare listeners to grasp the main subject of the sermon' },
      { key: 'preview', defaultValue: 'Give a brief overview of the sermon and set the theme' }
    ]
  },
  conclusion: {
    baseKey: 'structure.conclusionInfo',
    defaultTitle: 'Conclusion goals:',
    defaultAriaLabel: 'Conclusion guidance',
    items: [
      { key: 'repeat', defaultValue: 'Repeat the key points that were shared' },
      { key: 'edify', defaultValue: "Offer an edifying word showing God's love to the church" },
      { key: 'apply', defaultValue: 'Give application: what to do and how to apply the truths discussed' },
      { key: 'call', defaultValue: 'Call to repentance and action (not only hearers but doers)' },
      { key: 'hammer', defaultValue: '"Drive the nail" with the final clear phrases; you may end with "Thus says the Lord"; 1 Pet 4:11' }
    ]
  }
};

export const SermonSectionGuidanceTooltip: React.FC<{
  t: (key: string, options?: Record<string, unknown>) => string;
  section: SectionKind;
  popoverAlignment?: PopoverAlignment;
}> = ({ t, section, popoverAlignment = 'left' }) => {
  const { open, setOpen, popoverRef } = useDismissablePopover();
  const config = SECTION_CONFIG[section];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="p-1 bg-white/20 hover:bg-white/30 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        title={t(`${config.baseKey}.ariaLabel`, { defaultValue: config.defaultAriaLabel })}
        aria-label={t(`${config.baseKey}.ariaLabel`, { defaultValue: config.defaultAriaLabel })}
        aria-expanded={open}
      >
        <InformationCircleIcon className="h-5 w-5 text-white" />
      </button>
      {open && (
        <div className={`absolute ${popoverAlignment === 'right' ? 'right-0' : 'left-0'} mt-2 z-50 w-[320px]`}>
          <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 text-xs">
            <div className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
              {t(`${config.baseKey}.title`, { defaultValue: config.defaultTitle })}
            </div>
            <ul className="list-disc pl-4 space-y-1 text-gray-800 dark:text-gray-200">
              {config.items.map((item) => (
                <li key={item.key}>
                  {t(`${config.baseKey}.${item.key}`, { defaultValue: item.defaultValue })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export const OutlinePointGuidanceTooltip: React.FC<{
  t: (key: string, options?: Record<string, unknown>) => string;
  popoverAlignment?: PopoverAlignment;
}> = ({ t, popoverAlignment = 'left' }) => {
  const { open, setOpen, popoverRef } = useDismissablePopover();
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'right';
  }>({ vertical: 'top', horizontal: popoverAlignment === 'right' ? 'right' : 'left' });

  // Calculate tooltip positioning to stay within container bounds
  React.useEffect(() => {
    if (!open || !tooltipRef.current || !popoverRef.current) return;

    const tooltip = tooltipRef.current;
    const trigger = popoverRef.current;
    const container = trigger.closest('.overflow-y-auto') as HTMLElement;

    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Calculate preferred position (above trigger)
    const preferredTop = triggerRect.top - tooltipRect.height - 8; // 8px margin
    const preferredLeft = popoverAlignment === 'right'
      ? triggerRect.right - tooltipRect.width
      : triggerRect.left;

    // Check if tooltip fits in preferred position
    const fitsAbove = preferredTop >= containerRect.top;

    let vertical: 'top' | 'bottom' = 'top';
    let horizontal: 'left' | 'right' = popoverAlignment === 'right' ? 'right' : 'left';

    if (!fitsAbove) {
      // If doesn't fit above, try below
      const belowTop = triggerRect.bottom + 8;
      const fitsBelow = belowTop + tooltipRect.height <= containerRect.bottom;

      if (fitsBelow) {
        vertical = 'bottom';
      } else {
        // If doesn't fit below either, keep above but adjust horizontal if needed
        vertical = 'top';
      }
    }

    // Adjust horizontal position if tooltip would overflow container
    if (preferredLeft < containerRect.left) {
      horizontal = 'left'; // Force left alignment
    } else if (preferredLeft + tooltipRect.width > containerRect.right) {
      horizontal = 'right'; // Force right alignment
    }

    setTooltipPosition({ vertical, horizontal });
  }, [open, popoverAlignment, popoverRef]);

  return (
    <div className="relative shrink-0" ref={popoverRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="group p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300"
        title={t('structure.outlineHelp.ariaLabel', { defaultValue: 'Quick help for outline point' })}
        aria-label={t('structure.outlineHelp.ariaLabel', { defaultValue: 'Quick help for outline point' })}
        aria-expanded={open}
      >
        <InformationCircleIcon className="h-5 w-5 text-blue-500 dark:text-blue-300 group-hover:text-blue-600 dark:group-hover:text-blue-200" />
      </button>
      {open && (
        <div
          ref={tooltipRef}
          className={`absolute z-[60] w-[300px] ${
            tooltipPosition.vertical === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${
            tooltipPosition.horizontal === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 text-xs text-left">
            <div className="font-semibold mb-1 text-gray-800 dark:text-gray-100">
              {t('structure.outlineHelp.title')}
            </div>
            <ul className="list-disc pl-4 space-y-1 text-gray-700 dark:text-gray-200">
              <li>{t('structure.outlineHelp.verse')}</li>
              <li>{t('structure.outlineHelp.explanation')}</li>
              <li>{t('structure.outlineHelp.illustration')}</li>
              <li>{t('structure.outlineHelp.argumentation')}</li>
              <li>{t('structure.outlineHelp.application')}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
