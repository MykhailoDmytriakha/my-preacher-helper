export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
  outlinePointId?: string;
  position?: number;
  keyFragments?: string[]; // Store important text fragments for AI generation
  forceTag?: string; // Force tag for transcription (introduction, main, conclusion)
}

export interface OutlinePoint {
  id: string;
  text: string;
}

export interface Outline {
  introduction: OutlinePoint[];
  main: OutlinePoint[];
  conclusion: OutlinePoint[];
}

export interface Structure {
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

export interface ThoughtsPlan {
  introduction: string;
  main: string; 
  conclusion: string;
}

export interface Insights {
  topics: string[];
  relatedVerses: VerseWithRelevance[];
  possibleDirections: DirectionSuggestion[];
  thoughtsPlan?: ThoughtsPlan;
}

export interface VerseWithRelevance {
  reference: string;
  relevance: string;
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  outline?: Outline;
  structure?: Structure;
  userId: string;
  insights?: Insights;
  plan?: Plan;
  isPreached?: boolean;
  preparation?: Preparation;
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

export interface Item {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
  requiredTags?: string[];
  outlinePoint?: { text: string; section: string };
  outlinePointId?: string;
  position?: number;
}

export interface UserSettings {
  id: string;
  userId: string;
  language: string;
  isAdmin: boolean;
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

export interface Plan {
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
