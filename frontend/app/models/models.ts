export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
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

export interface Insights {
  topics: string[];
  relatedVerses: string[];
  possibleDirections: string[];
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  outline: OutlinePoint;
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
}

export interface UserSettings {
  id: string;
  userId: string;
  language: string;
  // Other future user settings can be added here
}