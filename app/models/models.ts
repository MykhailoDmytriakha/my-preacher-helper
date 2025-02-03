export interface Thought {
  text: string;
  tags: string[];
  relevant: boolean;
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  structure?: string;
} 