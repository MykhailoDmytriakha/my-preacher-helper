'use client';

import {
  BellAlertIcon,
  BookOpenIcon,
  BriefcaseIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  FireIcon,
  FlagIcon,
  HeartIcon,
  MapPinIcon,
  QuestionMarkCircleIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { useAuth } from '@/providers/AuthProvider';
import { CARE_CARD_TONES, type CareCardTone } from '@/utils/themeColors';

import type { ComponentType, SVGProps } from 'react';
import '@locales/i18n';

/**
 * THE PASTOR'S PLANE — the section behind the heart in the navigation.
 *
 * It used to be the prayer journal itself. It is becoming the place that holds what a
 * pastor cannot keep in his head: the people under his care, the orders of service he
 * performs rarely (and therefore forgets), and the answers he worked out once and wants
 * back years later.
 *
 * THE WORDS: three CARDS, and inside each of them SECTIONS. (They were called "rooms"
 * while this was being designed; the owner rejected the metaphor — a section is a place
 * you write in and look things up in, not a place you walk into. The word never reaches
 * the screen, but it decides how everything here is named.)
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE.
 *
 * 1. The map does not reshuffle. Every section has a card and keeps it from the first
 *    release. A section that is not built yet stays exactly where it will live and is drawn
 *    dimmed with a "soon" label. Moving the built ones to the front would make the plane a
 *    different page every release, and a person would have to re-learn it each time.
 *
 * 2. The card is not decoration — it is the NATURE of what it holds, and that nature
 *    decides how its sections behave later. `people` changes weekly and will need a "time
 *    to go" pulse; `ministry` is written once and opened in an hour when there is no time
 *    to think; `own` is the pastor's own side, which nobody else asks him about. Mixing
 *    them into one flat grid is how this page would turn into a second dashboard.
 *
 * 3. A number on a section is a PROMISE that it is true. The prayer journal shows the count
 *    of prayers actually standing open; a section with nothing to count shows nothing. A
 *    decorative digit here would teach a person to stop believing the page.
 */

type SectionKey =
  | 'people' | 'visits' | 'needs' | 'council'
  | 'rites' | 'crisis' | 'word' | 'projects'
  | 'prayers' | 'promises' | 'questions' | 'beforeGod';

type CardKey = 'people' | 'ministry' | 'own';

type CareSection = {
  key: SectionKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Present only for a section that is built. Absent means "soon", and the row is inert. */
  href?: string;
};

type CareCard = { key: CardKey; tone: CareCardTone; sections: CareSection[] };

/**
 * The prayer journal is the first section to move in, and it keeps its own route: the page,
 * its filters, its conflict handling and its tests all already work, and nothing about this
 * change is worth breaking them. The heart in the navigation stays lit on `/prayers` for
 * the same reason (`navConfig.ts`) — opening a section is not leaving the plane.
 *
 * The scroll comes from lucide because Heroicons has no symbol for an order of service at
 * all; every other icon here is Heroicons outline, drawn at the same 1.5 stroke.
 */
const CARDS: CareCard[] = [
  {
    key: 'people',
    tone: 'indigo',
    sections: [
      { key: 'people', icon: UsersIcon },
      { key: 'visits', icon: MapPinIcon },
      { key: 'needs', icon: BellAlertIcon },
      { key: 'council', icon: ChatBubbleLeftRightIcon },
    ],
  },
  {
    key: 'ministry',
    tone: 'emerald',
    sections: [
      { key: 'rites', icon: ScrollText },
      { key: 'crisis', icon: ExclamationTriangleIcon },
      { key: 'word', icon: BookOpenIcon },
      { key: 'projects', icon: BriefcaseIcon },
    ],
  },
  {
    key: 'own',
    tone: 'rose',
    sections: [
      { key: 'prayers', icon: FireIcon, href: '/prayers' },
      { key: 'promises', icon: FlagIcon },
      { key: 'questions', icon: QuestionMarkCircleIcon },
      { key: 'beforeGod', icon: HeartIcon },
    ],
  },
];

/**
 * EVERY ROW IS THE SAME HEIGHT, in every card, whether its hint takes one line or two.
 * The cards hold four sections each, so equal rows make the three inner panels end on the
 * same line by construction — no card "sags" because one description happens to be longer,
 * and nothing has to be truncated to keep the page tidy.
 */
const rowBaseClass = 'group flex h-16 items-center gap-3 rounded-xl px-3';
const rowOpenClass =
  'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
/** The panel draws its own hairline: white on white (and near-black on near-black) is not a shape. */
const panelClass =
  'flex-1 rounded-2xl border border-gray-100 bg-white p-1.5 dark:border-gray-800 dark:bg-gray-900';

export default function CarePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // The same list the journal itself reads, so opening the plane also warms its cache.
  const { prayerRequests } = usePrayerRequests(user?.uid ?? null);

  const counts = useMemo<Partial<Record<SectionKey, number>>>(
    () => ({
      prayers: (prayerRequests ?? []).filter((prayer) => prayer.status === 'active').length,
    }),
    [prayerRequests]
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
        {t('care.title')}
      </h1>

      <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const tone = CARE_CARD_TONES[card.tone];

          return (
            <section
              key={card.key}
              className={`flex h-full flex-col rounded-2xl border p-5 ${tone.wash} ${tone.edge}`}
              aria-labelledby={`care-card-${card.key}`}
            >
              <h2
                id={`care-card-${card.key}`}
                className={`px-1 text-lg font-extrabold tracking-tight ${tone.title}`}
              >
                {t(`care.cards.${card.key}.title`)}
              </h2>
              <p className={`mb-3.5 mt-1.5 px-1 text-xs leading-relaxed ${tone.hint}`}>
                {t(`care.cards.${card.key}.hint`)}
              </p>

              <ul className={panelClass}>
                {card.sections.map((section) => (
                  <li key={section.key}>
                    <SectionRow section={section} tone={card.tone} count={counts[section.key]} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SectionRow({
  section,
  tone,
  count,
}: {
  section: CareSection;
  tone: CareCardTone;
  count?: number;
}) {
  const { t } = useTranslation();
  const toneClasses = CARE_CARD_TONES[tone];
  const Icon = section.icon;
  const built = Boolean(section.href);

  const body = (
    <>
      <Icon
        className={`h-5 w-5 shrink-0 ${built ? toneClasses.icon : 'text-gray-300 dark:text-gray-600'}`}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-bold tracking-tight transition-colors ${
            built
              ? `text-gray-900 dark:text-gray-100 ${toneClasses.rowTitleHover}`
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {t(`care.sections.${section.key}.title`)}
        </span>
        <span className="block line-clamp-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {t(`care.sections.${section.key}.hint`)}
        </span>
      </span>
      {built && count !== undefined && count > 0 && (
        <span className="shrink-0">
          {/* A reader announced the title, the hint, and then bare "2". The digit is for the
              eye; the words say what it counts, in the reader's own language. */}
          <span className="sr-only">{t('care.activePrayers', { count })}</span>
          <span className={`text-base font-extrabold ${toneClasses.count}`} aria-hidden="true">
            {count}
          </span>
        </span>
      )}
      {!built && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('care.soon')}
        </span>
      )}
    </>
  );

  if (section.href) {
    return (
      <Link
        href={section.href}
        className={`${rowBaseClass} ${rowOpenClass} ${toneClasses.rowHover} ${toneClasses.focus}`}
        data-testid={`care-section-${section.key}`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div
      /*
       * A section that is not built still ANSWERS the mouse — a page where eleven of twelve
       * rows are dead feels broken rather than unfinished. It answers quietly and in grey,
       * with the default cursor: enough to say "I see you", never enough to promise a click.
       */
      className={`${rowBaseClass} cursor-default transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/40`}
      data-testid={`care-section-${section.key}`}
      // Not a button and not a link: there is nothing behind it yet, and a control that
      // looks pressable but answers nothing is worse than a plain row that says "soon".
      title={t('care.soonHint')}
    >
      {body}
    </div>
  );
}
