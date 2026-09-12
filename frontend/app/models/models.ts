import type { ProviderId } from '@/api/clients/ai/providerId';

export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
  outlinePointId?: string | null;
  subPointId?: string | null;
  position?: number;
  isLocked?: boolean;
  keyFragments?: string[]; // Store important text fragments for AI generation
}

/**
 * WHERE A SCRATCH NOTE WAS CUT FROM, when it came out of a study note.
 *
 * Absent on notes the preacher dictated or typed. Present on atoms the cutter produced,
 * so a second "take from the note" can recognise its own earlier atoms instead of
 * duplicating them, and a card can point back at the section it was cut from.
 */
export interface ScratchNoteSource {
  noteId: string;
  /** The section heading the atom was cut from; empty for text before the first heading. */
  heading: string;
}

export interface ScratchNote {
  id: string;
  text: string;
  createdAt: string;
  section?: 'introduction' | 'main' | 'conclusion';
  source?: ScratchNoteSource;
}

/**
 * Represents a sub-point within an outline point.
 * Sub-points are optional inner headings that let the preacher
 * build a deeper skeleton inside a single outline point.
 * Thoughts can be assigned to a sub-point via `Thought.subPointId`.
 */
export interface SubPoint {
  id: string;
  text: string;
  position: number; // fractional position among siblings in the parent outline point
  /**
   * Short reminder — "what I want to say here" — jotted on the sub-point itself,
   * BEFORE it gets filled with full thoughts. A skeleton hint, kept separate from
   * the thoughts. Optional; personal to this sermon (not carried into plan templates).
   */
  note?: string;
}

/**
 * Represents a point in the sermon outline (introduction, main, or conclusion section).
 * Each point is a building block of the sermon structure.
 */
export interface OutlinePoint {
  id: string;
  text: string;
  isReviewed?: boolean;
  subPoints?: SubPoint[];
  /**
   * Short reminder — "what I want to say here" — jotted on the point itself,
   * BEFORE it gets filled with full thoughts. A skeleton hint, kept separate from
   * the thoughts. Optional; personal to this sermon (not carried into plan templates).
   */
  note?: string;
}

/** @deprecated Use OutlinePoint instead. Kept for backward compatibility. */
export type SermonPoint = OutlinePoint;

export interface SermonOutline {
  introduction: OutlinePoint[];
  main: OutlinePoint[];
  conclusion: OutlinePoint[];
}

/**
 * A reusable, named sermon plan skeleton: the outline structure (points +
 * sub-points across the three sections) WITHOUT any thoughts. Stored per user in
 * the `planTemplates` collection; applied to a sermon's outline from the plan
 * editor, or managed under Settings.
 */
export interface PlanTemplate {
  id: string;
  userId: string;
  name: string;
  structure: SermonOutline;
  createdAt: string;
  updatedAt: string;
  /** Per-aggregate revision counters — see conflictSafeUpdate.client.ts. */
  rev?: Record<string, number>;
}

export interface ThoughtsBySection {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous?: string[];
}

export interface DirectionSuggestion {
  area?: string;           // Supports the original format
  suggestion?: string;     // Supports the original format
  title?: string;          // Supports the schema format
  description?: string;    // Supports the schema format
  examples?: string[];     // Supports the schema format
  id?: string;
}

export interface BrainstormSuggestion {
  id: string;
  text: string;
  type: 'text' | 'question' | 'context' | 'reflection' | 'relationship' | 'application' | 'synthesis' | 'multi-perspective';
  complexity?: 'basic' | 'moderate' | 'high' | 'multi-dimensional';
  dimensions?: string[];
}

export interface SectionHints {
  introduction: string;
  main: string;
  conclusion: string;
}

export interface Insights {
  topics: string[];
  relatedVerses: VerseWithRelevance[];
  possibleDirections: DirectionSuggestion[];
  sectionHints?: SectionHints;
}

export interface VerseWithRelevance {
  reference: string;
  relevance: string;
}

export interface Church {
  id: string;
  name: string;
  city?: string;
}

export type PreachDateStatus = 'planned' | 'preached';

export interface PreachDate {
  id: string;
  date: string;                    // ISO date string (YYYY-MM-DD)
  status?: PreachDateStatus;       // planned (scheduled) vs preached (fact)
  church: Church;                  // Required: church name and city
  audience?: string;                // Optional: audience description
  notes?: string;                  // Optional: notes about the preaching
  outcome?: 'excellent' | 'good' | 'average' | 'poor'; // Optional: outcome rating
  createdAt: string;                // ISO timestamp when date was added
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  scratch?: ScratchNote[];
  outline?: SermonOutline;
  thoughtsBySection?: ThoughtsBySection;
  /** Legacy alias kept for backward compatibility with stored documents */
  structure?: ThoughtsBySection;
  userId: string;
  insights?: Insights;
  draft?: SermonContent;
  /** Legacy alias kept for backward compatibility with stored documents */
  plan?: SermonContent;
  /**
   * THE PLAN'S TEXT, KEYED BY NODE ID — the single place it lives.
   *
   * Replaces `plan.<section>.outlinePoints` (text scattered per section) and
   * `plan.<section>.outline` (the assembled document, which is no longer stored at all —
   * see `utils/planText.ts`). A save writes ONE key, so saving one card cannot overwrite
   * another, and the document is assembled at read time so it cannot go stale.
   *
   * `plan`/`draft` stay readable for sermons that have not been saved since; they are a
   * fallback for READING only. Nothing writes them any more.
   */
  planText?: Record<string, string>;
  /**
   * WHICH EDITOR THIS PLAN IS KEPT IN.
   *
   * Both editors write the same `planText`, so the data alone cannot say who wrote it — and
   * with nothing recorded, every shortcut sent people to the paired AI screen. For a plan
   * written by hand that is not merely the wrong room: that screen renders one cell per
   * outline POINT, so text under sub-points is not shown at all and the preacher meets his
   * own plan with half of it apparently missing.
   *
   * Set by the toggle on the plan screens, and recorded on the first save from an editor
   * when it has never been set — so a plan started by hand goes on opening by hand without
   * anyone having to know this field exists.
   *
   * ABSENT MEANS "NEVER RECORDED", NOT "AI". Every sermon written before this field existed
   * answers `undefined`, and those keep the routing they already had; changing it would move
   * people's plans out from under them on the day it ships.
   */
  planMode?: 'manual' | 'ai' | 'note';
  isPreached?: boolean;
  preparation?: Preparation;

  // Series integration
  seriesId?: string;              // Reference to series
  seriesPosition?: number;        // Order in series (1-indexed)

  /**
   * THE STUDY NOTES THIS SERMON WAS BUILT ON — and the sermon owns that fact.
   *
   * "This sermon grew out of that note" is a statement ABOUT THE SERMON, so it is stored
   * here and nowhere else. The other direction — "which sermons were built on this note" —
   * is DERIVED from the owner-scoped sermon list the app already caches (`sermonListKey`),
   * exactly as series membership is derived instead of mirrored. One side writes, one side
   * reads: there is no second copy that can disagree.
   *
   * `StudyNote.relatedSermonIds` is deliberately NOT used for this. Its own service strips
   * it on create as a derived field, and note saves run under a revision + open-time
   * baseline guard, so a link written from the sermon screen would surface there as a
   * foreign edit and be refused.
   *
   * Absent means "never linked". Removing the last link writes `[]` rather than deleting
   * the key, so the write guard's baseline comparison stays meaningful.
   */
  sourceNoteIds?: string[];

  preachDates?: PreachDate[];      // Array of preach dates

  // Audio Generation (Beta)
  /** Cached speech-optimized text chunks for TTS */
  audioChunks?: {
    text: string;
    sectionId: string;
    createdAt: string;
    index: number;
  }[];
  /** Metadata about last audio generation */
  audioMetadata?: {
    provider?: string;
    voice: string;
    model: string;
    lastGenerated: string;
    chunksCount: number;
    /** Which source produced the current chunks: 'ai' (GPT-optimized) | 'raw' (original as-is) */
    mode?: 'ai' | 'raw';
    /** ISO timestamp of last text preparation */
    lastOptimized?: string;
  };
  updatedAt?: string;
  /** Revision per editable aggregate; absent reads as 0. See conflictSafeUpdate.client.ts */
  rev?: Record<string, number>;
}

export type SeriesKind = 'sermon' | 'group' | 'mixed';
export type SeriesItemType = 'sermon' | 'group';

export interface SeriesItem {
  id: string;
  type: SeriesItemType;
  refId: string;
  position: number;
  plannedDate?: string;
  completedAt?: string;
}

export type GroupBlockTemplateType =
  | 'announcement'
  | 'topic'
  | 'scripture'
  | 'questions'
  | 'explanation'
  | 'notes'
  | 'prayer'
  | 'custom';

export type GroupBlockStatus = 'empty' | 'draft' | 'filled';

export interface GroupBlockTemplate {
  id: string;
  type: GroupBlockTemplateType;
  title: string;
  summary?: string;
  content: string;
  scriptureRefs?: string[];
  questions?: string[];
  status: GroupBlockStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GroupFlowItem {
  id: string;
  templateId: string;
  order: number;
  durationMin?: number | null;
  instanceTitle?: string;
  instanceNotes?: string;
}

export interface GroupMeetingDate {
  id: string;
  date: string;
  location?: string;
  audience?: string;
  notes?: string;
  outcome?: 'excellent' | 'good' | 'average' | 'poor';
  createdAt: string;
}

export interface Group {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: 'draft' | 'active' | 'completed';
  templates: GroupBlockTemplate[];
  flow: GroupFlowItem[];
  meetingDates?: GroupMeetingDate[];
  seriesId?: string | null;
  seriesPosition?: number | null;
  createdAt: string;
  updatedAt: string;
  /** Revision per editable aggregate; absent reads as 0. */
  rev?: Record<string, number>;
}

export interface Preparation {
  spiritual?: {
    readAndPrayedConfirmed?: boolean;
  };
  textContext?: {
    passage?: string;
    passageSummary?: string;
    repeatedWords?: string[];
    contextNotes?: string;
    readWholeBookOnceConfirmed?: boolean;
  };
  exegeticalPlan?: ExegeticalPlanNode[];
  authorIntent?: string;
  mainIdea?: {
    contextIdea?: string;
    textIdea?: string;
    argumentation?: string;
  };
  thesis?: {
    exegetical?: string;
    homiletical?: string;
    oneSentence?: string; // Тезис в одном предложении (до 20 слов)
    // Доп. поля для детального оформления тезиса
    questionWord?: string; // Вопрос к тезису (почему/как/что/когда/где)
    pluralKey?: string; // Ключевое слово (существительное во множественном числе)
    transitionSentence?: string; // Переходная фраза к пунктам
    sermonInOneSentence?: string; // Вся проповедь, сжатая в одном предложении
    homileticalAnswers?: { // Ответы на вопросы к экзегетическому тезису
      whyPreach?: string;
      impactOnChurch?: string;
      practicalQuestions?: string;
    }
  };
  timelessTruth?: string;
  christConnection?: string;
  preachingGoal?: {
    /**
     * High-level goal type of the sermon message
     * informative – inform the listener
     * proclamation – proclaim God's will (as a herald)
     * didactic – teach and explain
     * exhortative – move listeners to purposeful action
     */
    type?: 'informative' | 'proclamation' | 'didactic' | 'exhortative';
    /**
     * Clear goal statement: "К какой цели я веду?"
     */
    statement?: string;
  };
  /** Homiletic planning container */
  homileticPlan?: {
    modernTranslation?: string;
    updatedPlan?: { id: string; title: string }[];
    sermonPlan?: { id: string; title: string }[];
  };
}

export interface Series {
  id: string;
  userId: string;
  title?: string;                 // e.g., "Book of Romans"
  description?: string;
  theme: string;                  // e.g., "Grace and Law"
  bookOrTopic: string;            // "Romans" or "Grace"

  sermonIds: string[];            // Ordered array of sermon IDs
  /** Unified ordered list of references to sermons/groups in this series */
  items?: SeriesItem[];
  /** Optional UX hint for filtering and labeling series composition */
  seriesKind?: SeriesKind;

  startDate?: string;             // ISO date
  duration?: number;              // weeks
  color?: string;                 // Theme color
  status: 'draft' | 'active' | 'completed';

  createdAt: string;
  updatedAt: string;
  /** Revision per editable aggregate; absent reads as 0. */
  rev?: Record<string, number>;
}

export interface ExegeticalPlanNode {
  id: string;
  title: string;
  children?: ExegeticalPlanNode[];
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  required: boolean;
  translationKey?: string;
}

export interface TagInfo {
  name: string;
  color: string;
  translationKey?: string;
}

export interface ThoughtInStructure {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
  requiredTags?: string[];
  outlinePoint?: { text: string; section: string };
  outlinePointId?: string | null;
  subPointId?: string | null;
  position?: number;
  isLocked?: boolean;
}

export interface UserSettings {
  id: string;
  userId: string;
  language: string;
  firstDayOfWeek?: 'sunday' | 'monday';
  enablePrepMode?: boolean;  // Per-user prep mode access
  enableAudioGeneration?: boolean; // Beta: audio generation feature
  enableStructurePreview?: boolean; // Beta: Structure Preview feature
  enableGroups?: boolean; // Legacy preference; released groups are available to all signed-in users
  showAppVersion?: boolean; // Show deployed build version in Settings
  email?: string;
  displayName?: string;
  /** Preference only; the server validates it against the effective tier allowlist. Not a privilege grant. */
  preferredProviderId?: ProviderId;
  preferredModelId?: string;
  /** Per-function preferences are client-writable; server policy remains authoritative. */
  preferredTranscription?: { providerId: ProviderId; modelId: string };
  preferredText?: { providerId: ProviderId; modelId: string };
  preferredTts?: { providerId: ProviderId; modelId: string };
}

/**
 * Server-managed monetization levels stored as `paidTier` on `users/{uid}`.
 * Append new paid tiers in ascending entitlement order.
 */
export const TIER_VALUES = ['free', 'tier1', 'tier2', 'tier3', 'tier4'] as const;
export type Tier = typeof TIER_VALUES[number];

/**
 * Entitlement and admin-info fields stored at the top level of `users/{uid}`.
 * Monetization and referral fields are server-managed; `lastSeenAt` is not.
 */
export interface UserEntitlement {
  paidTier: Tier;
  /** Server-managed referral attribution. Clients must never write this field. */
  referredBy?: string;
  /** Client-supplied ISO-8601 activity hint for low-stakes admin display only. */
  lastSeenAt?: string;
  promotion?: {
    tier: Tier;
    expiresAt: string;
  };
  usage?: {
    aiUsed: number;
    transcriptionSecondsUsed: number;
    /** Optional for compatibility with usage records persisted before audio metering. */
    audioSecondsUsed?: number;
    /** ISO-8601 UTC anchor for the calendar month containing this usage. */
    periodStart: string;
  };
}

/**
 * Represents the generated content for each section of the sermon.
 * This is the AI-generated text based on thoughts and outline points.
 */
export interface SermonContent {
  introduction: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  main: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
  conclusion: {
    outline: string;
    outlinePoints?: Record<string, string>;
  }
}

/** @deprecated Use SermonContent instead. Kept for backward compatibility. */
export type SermonDraft = SermonContent;

// Legacy aliases kept for backward compatibility during refactor

/**
 * Lightweight scripture reference used by study notes.
 * We keep it normalized to make filtering by book/chapter simple on the client.
 * 
 * Semantic rules:
 * - book only: entire book reference (e.g., Ezekiel)
 * - book + chapter: entire chapter reference (e.g., Psalm 23)
 * - book + chapter + toChapter: chapter range (e.g., Matthew 5-7)
 * - book + chapter + fromVerse: specific verse (e.g., John 3:16)
 * - book + chapter + fromVerse + toVerse: verse range (e.g., 1 Cor 13:4-8)
 */
export interface ScriptureReference {
  id: string;
  book: string;
  /** Chapter number. Omit if reference is to entire book. */
  chapter?: number;
  /** Ending chapter for chapter ranges (e.g., Matthew 5-7). */
  toChapter?: number;
  /** Starting verse number. Omit if reference is to entire chapter. */
  fromVerse?: number;
  toVerse?: number;
  /** Optional user-supplied text snippet (RST or other translation). */
  text?: string;
}

export interface StudyNote {
  id: string;
  userId: string;
  content: string;
  title?: string;
  scriptureRefs: ScriptureReference[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Calculated draft status stored for quick filtering */
  isDraft: boolean;
  /** Materials (sermons / groups / studies) that use this note */
  materialIds?: string[];
  /**
   * @deprecated Never written, and no longer writable. The link "this sermon was built on
   * this note" lives ONLY in `Sermon.sourceNoteIds`; the list of sermons for a note is
   * derived from the cached sermon list (`useSermonsBuiltOnNote`). Kept on the type because
   * documents written long ago may still carry the key.
   */
  relatedSermonIds?: string[];
  /** Type of the note: standard note or a question to be answered later */
  type?: 'note' | 'question';
  /**
   * Revision counter per editable aggregate, used to refuse a save built from an
   * older version. Absent on documents written before the guard existed — read as 0.
   */
  rev?: Record<string, number>;
}

export interface StudyNoteShareLink {
  id: string;
  noteId: string;
  ownerId: string;
  token: string;
  createdAt: string;
  viewCount: number;
}

export type StudyMaterialType = 'sermon' | 'study' | 'group' | 'guide';

export interface MaterialSection {
  id: string;
  title: string;
  noteIds: string[];
  connector?: string;
}

export interface StudyMaterial {
  id: string;
  userId: string;
  title: string;
  type: StudyMaterialType;
  description?: string;
  noteIds: string[];
  sections?: MaterialSection[];
  createdAt: string;
  updatedAt: string;
}
export type Outline = SermonOutline;
export type Structure = ThoughtsBySection;
export type Item = ThoughtInStructure;
export type ThoughtsPlan = SectionHints;
export type Plan = SermonContent;

export interface PlanData {
  sermonTitle: string;
  sermonVerse: string;
  introduction: string;
  main: string;
  conclusion: string;
  exportDate?: string;
}

// Prayer Journal

export type PrayerStatus = 'active' | 'answered' | 'not_answered';

export interface PrayerUpdate {
  id: string;
  text: string;
  createdAt: string;
}

export interface PrayerRequest {
  id: string;
  userId: string;
  title: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  status: PrayerStatus;
  updates: PrayerUpdate[];
  createdAt: string;
  updatedAt: string;
  answeredAt?: string;
  answerText?: string;
  /** Per-aggregate revision counters — see conflictSafeUpdate.client.ts. */
  rev?: Record<string, number>;
}

export interface PrayerCategory {
  id: string;
  userId: string;
  name: string;
  color?: string;
  createdAt: string;
}

/**
 * ORDERS OF SERVICE — the pastor's own reference book for what he performs rarely.
 *
 * A REFERENCE, NOT A JOURNAL. There is one document per rite and performing it leaves no
 * record: the owner asked for exactly this ("записи каждого совершенного не нужно, это больше
 * как справочник"). Adding instances later would turn a book you open into a history you have
 * to maintain, and the maintenance is what kills tools of this class.
 */
export type ServiceOrderCatalogKey =
  | 'funeral' | 'wedding' | 'baptism' | 'communion' | 'childBlessing'
  | 'visit' | 'ordination' | 'membership' | 'anointing' | 'houseBlessing';

export interface ServiceOrderStep {
  /** Client-generated, stable for the life of the step: writes are keyed by it, not by index. */
  id: string;
  title: string;
  /** The pastor's own words. The app never ships any. */
  body?: string;
  scriptureRefs?: string[];
  /** "Не забыть" — the thing that goes wrong when it is forgotten. */
  flagged?: boolean;
}

export interface ServiceOrder {
  id: string;
  userId: string;
  /**
   * Present only on an order seeded from the built-in starting sequence, and NEVER edited afterwards:
   * it is the catalog identity, not the category. The title above it is free — a pastor may
   * keep two funeral orders, and the second one is simply a custom order called "Погребение
   * ребёнка". Overloading one field with identity, category and uniqueness is how that
   * becomes impossible.
   */
  catalogKey?: ServiceOrderCatalogKey;
  title: string;
  summary?: string;
  steps: ServiceOrderStep[];
  /**
   * WHERE IT SITS IN HIS LIST — his decision, not ours.
   *
   * A midpoint between neighbours rather than an index, so moving one rite writes ONE
   * document: an index would rewrite every row it shifted past, and half of those writes can
   * be lost on a phone with no signal. Ties (two devices moving into the same gap while
   * offline) are broken by document id, and a gap that collapses is repaired by renumbering
   * the whole list — see `serviceOrderRank.ts`.
   */
  rank: number;
  createdAt: string;
  updatedAt: string;
  /** Revision per editable aggregate; absent reads as 0. */
  rev?: Record<string, number>;
}

/**
 * BROTHERS' COUNCIL — the regular meeting of the church's ministers, as the pastor prepares
 * it and then runs it.
 *
 * A council is an EVENT with a life: it is prepared (sections are written down: what the
 * matter is, what the brothers may ask, what could be decided), it is held (the pastor walks
 * the sections and marks what was accepted), and afterwards it stays as a record with its
 * date. The owner described exactly this shape ("есть список подготовленных, есть прошлые;
 * внутри секции: название, короткое объяснение, вопросы братьев, решения, которые можем
 * принять"), and it mirrors how a group meeting is run in `/groups/[id]/conduct`.
 *
 * What is NOT here, on purpose: attendance, votes, budgets, and the content of anyone's
 * confession — a council record keeps the matter and the decision, never the conversation.
 */
export type CouncilStatus = 'preparing' | 'held';

export interface CouncilTopicQuestion {
  id: string;
  /** What a brother may ask about this matter. */
  question: string;
  /** The pastor's prepared answer. */
  answer?: string;
}

export interface CouncilTopicOption {
  id: string;
  text: string;
}

/**
 * One edit of a topic's outcome AFTER the council was held. The owner wants to see "было так,
 * стало так" with the date, so the record is never silently overwritten.
 */
export interface CouncilTopicChange {
  at: string;
  from: string;
  to: string;
}

export interface CouncilTopic {
  /** Client-generated, stable for the life of the section. */
  id: string;
  /**
   * What the section is FOR. Absent means a decision is expected — options, a line of what
   * was decided. `info` is a section the pastor only says: context, an announcement, a
   * report; at the council it is ticked as told, nothing is decided.
   */
  kind?: 'decision' | 'info';
  title: string;
  /** Short explanation: what the matter is and what the pastor proposes. */
  summary?: string;
  questions: CouncilTopicQuestion[];
  options: CouncilTopicOption[];
  /** Marked for the members' meeting — the council prepares proposals for it. */
  forAssembly?: boolean;
  /**
   * DERIVED, never ticked by hand: true exactly when an option was accepted or a decision was
   * written (the owner: "галочка условная, а не ручная"). Kept on the record so lists and
   * counts read it without re-deriving.
   */
  discussed?: boolean;
  /** The council did not decide: it put the matter off, or took it off the agenda. */
  resolution?: 'postponed' | 'dropped';
  /** Which prepared option the council accepted, if one of them. */
  acceptedOptionId?: string;
  /** What was decided, typed in a line — with or without an accepted option. */
  decision?: string;
  changes?: CouncilTopicChange[];
  /** Set on a section that was not talked through and was carried to a later council. */
  carriedToCouncilId?: string;
}

export interface Council {
  id: string;
  userId: string;
  title: string;
  /** Planned day, YYYY-MM-DD; a council may be prepared before its date is known. */
  date?: string;
  status: CouncilStatus;
  /** When the pastor finished conducting it. */
  heldAt?: string;
  topics: CouncilTopic[];
  createdAt: string;
  updatedAt: string;
  /** Server-kept revision of the whole document; a write states the one it was built on. */
  rev?: number;
}
