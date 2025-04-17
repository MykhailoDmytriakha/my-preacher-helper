export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
  outlinePointId?: string;
  keyFragments?: string[]; // Store important text fragments for AI generation
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

export interface Insights {
  topics: string[];
  relatedVerses: VerseWithRelevance[];
  possibleDirections: DirectionSuggestion[];
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

