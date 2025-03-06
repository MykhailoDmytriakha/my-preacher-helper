export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
  outlinePointId?: string;
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
  area: string;
  suggestion: string;
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
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  required: boolean;
}

export interface TagInfo {
  name: string;
  color: string;
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