import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Thought, Outline } from '@/models/models';
import ThoughtCard from '@components/ThoughtCard';

interface ThoughtListProps {
  filteredThoughts: Thought[];
  totalThoughtsCount: number;
  allowedTags: { name: string; color: string }[];
  sermonOutline: Outline | null | undefined;
  onDelete: (thoughtId: string) => void;
  onEditStart: (thought: Thought, index: number) => void;
  resetFilters: () => void;
}

const ThoughtList: React.FC<ThoughtListProps> = ({
  filteredThoughts,
  totalThoughtsCount,
  allowedTags,
  sermonOutline,
  onDelete,
  onEditStart,
  resetFilters,
}) => {
  const { t } = useTranslation();

  if (totalThoughtsCount === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          {t('sermon.noThoughts')}
        </p>
      </div>
    );
  }

  if (filteredThoughts.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          {t('filters.noMatchingThoughts')}
        </p>
        <button 
          onClick={resetFilters} 
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {t('filters.resetFilters')}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="sermon-thoughts-container" className="space-y-5">
      {filteredThoughts.map((thought, index) => (
        <ThoughtCard
          key={thought.id} // Use stable ID for key
          thought={thought}
          index={index} // Pass index if needed by ThoughtCard
          allowedTags={allowedTags}
          sermonOutline={sermonOutline ?? undefined} // Pass undefined if null
          onDelete={() => onDelete(thought.id)} // Pass only thought ID
          onEditStart={() => onEditStart(thought, index)} // Pass thought and index
        />
      ))}
    </div>
  );
};

export default ThoughtList; 