export interface Thought {
  text: string;
  tag: "introduction" | "main" | "conclusion" | "auto-generated";
  createdAt: Date;
}

export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  structure?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export const getSermons = async (): Promise<Sermon[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons`);
    if (!response.ok) throw new Error('Failed to fetch sermons');
    return await response.json();
  } catch (error) {
    console.error('Error fetching sermons:', error);
    return [];
  }
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/${id}`);
    if (!response.ok) throw new Error('Failed to fetch sermon');
    return await response.json();
  } catch (error) {
    console.error(`Error fetching sermon ${id}:`, error);
    return undefined;
  }
};
