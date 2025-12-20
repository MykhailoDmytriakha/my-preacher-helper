export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
  outlinePointId?: string | null;
  position?: number;
  keyFragments?: string[]; // Store important text fragments for AI generation
  forceTag?: string; // Force tag for transcription (introduction, main, conclusion)
}

export interface SermonPoint {
  id: string;
  text: string;
  isReviewed?: boolean;
}

export interface SermonOutline {
  introduction: SermonPoint[];
  main: SermonPoint[];
  conclusion: SermonPoint[];
}

export interface ThoughtsBySection {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
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

export interface PreachDate {
  id: string;
  date: string;                    // ISO date string (YYYY-MM-DD)
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
  outline?: SermonOutline;
  thoughtsBySection?: ThoughtsBySection;
  /** Legacy alias kept for backward compatibility with stored documents */
  structure?: ThoughtsBySection;
  userId: string;
  insights?: Insights;
  draft?: SermonDraft;
  /** Legacy alias kept for backward compatibility with stored documents */
  plan?: SermonDraft;
  isPreached?: boolean;
  preparation?: Preparation;

  // Series integration
  seriesId?: string;              // Reference to series
  seriesPosition?: number;        // Order in series (1-indexed)

  preachDates?: PreachDate[];      // Array of preach dates
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

  startDate?: string;             // ISO date
  duration?: number;              // weeks
  color?: string;                 // Theme color
  status: 'draft' | 'active' | 'completed';

  createdAt: string;
  updatedAt: string;
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
  position?: number;
}

export interface UserSettings {
  id: string;
  userId: string;
  language: string;
  isAdmin: boolean;
  enablePrepMode?: boolean;  // NEW: Per-user prep mode access
  email?: string;
  displayName?: string;
}

export interface User {
  id: string;               // ID пользователя из Firebase Auth
  email?: string;           // Электронная почта пользователя
  displayName?: string;     // Отображаемое имя пользователя
  createdAt: string;        // Дата создания аккаунта
  lastLogin: string;        // Дата последнего входа
  isAnonymous: boolean;     // Является ли пользователь гостем
  isPremium: boolean;       // Имеет ли пользователь премиум-подписку
  premiumExpiration?: string; // Дата окончания премиум-подписки
  usageStats: {             // Статистика использования
    sermonsCreated: number;  // Количество созданных проповедей
    thoughtsCreated: number; // Количество созданных мыслей
    lastActivity: string;    // Дата последней активности
    aiRequestsMade: number;  // Количество использованных AI запросов
    tagsCreated: number;     // Количество созданных тегов
  }
}

export interface SermonDraft {
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

// Legacy aliases kept for backward compatibility during refactor
export type OutlinePoint = SermonPoint;

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
  /** Optional links to existing sermons */
  relatedSermonIds?: string[];
  /** Type of the note: standard note or a question to be answered later */
  type?: 'note' | 'question';
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
export type Plan = SermonDraft;
