export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
}

export interface Structure {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  structure?: Structure;
  userId: string;
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