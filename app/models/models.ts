export interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  structure?: string;
  userId: string;
}

export interface Tag {
  userId: string;
  name: string;
  color: string;
  required: boolean;
}