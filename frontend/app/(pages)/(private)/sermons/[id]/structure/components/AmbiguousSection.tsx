import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy } from "@dnd-kit/sortable";
import React from "react";
import { useTranslation } from 'react-i18next';

import SortableItem from "@/components/SortableItem";
import { Item } from "@/models/models";
import { LOCAL_THOUGHT_PREFIX } from "@/utils/pendingThoughtsStore";

interface DummyDropZoneProps {
  container: string;
}

const DummyDropZone: React.FC<DummyDropZoneProps> = ({ container }) => {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ 
    id: 'dummy-drop-zone',
    data: { container: 'ambiguous' } 
  });
  
  return (
    <div
      ref={setNodeRef}
      data-container={container}
      style={{ minHeight: "80px" }}
      className={`p-4 text-center text-gray-400 dark:text-gray-500 border-dashed border-2 col-span-full rounded transition-all ${
        isOver 
          ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
          : 'border-gray-300 dark:border-gray-600'
      }`}
    >
      {t('structure.dropToAmbiguous', { defaultValue: 'Drop thoughts here to mark as unclear' })}
    </div>
  );
};

const AdditionalDropZone: React.FC = () => {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ 
    id: 'ambiguous-additional-drop',
    data: { container: 'ambiguous' } 
  });
  
  return (
    <div
      ref={setNodeRef}
      className={`p-3 text-center text-gray-400 dark:text-gray-500 border-dashed border-2 rounded transition-all ${
        isOver 
          ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
          : 'border-gray-300 dark:border-gray-600'
      }`}
    >
      {t('structure.dropToAmbiguous')}
    </div>
  );
};

interface AmbiguousSectionProps {
  items: Item[] | null | undefined;
  isVisible: boolean;
  onToggleVisibility: () => void;
  onEdit: (item: Item) => void;
  onDelete: (itemId: string, containerId: string) => void;
  deletingItemId: string | null;
  activeId: string | null;
  focusedColumn: string | null;
  columnTitle: string;
}

export const AmbiguousSection: React.FC<AmbiguousSectionProps> = ({
  items,
  isVisible,
  onToggleVisibility,
  onEdit,
  onDelete,
  deletingItemId,
  activeId,
  focusedColumn,
  columnTitle,
}) => {
  // Handle null/undefined items
  const safeItems = items || [];
  const itemCount = safeItems.length;

  // Only show ambiguous section if not in focus mode or if it has content
  if (focusedColumn && itemCount === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <div
        className={`bg-white dark:bg-gray-800 rounded-md shadow border ${
          itemCount > 0 ? "border-red-500" : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <button
          className="flex items-center justify-between p-4 cursor-pointer w-full text-left"
          onClick={onToggleVisibility}
          aria-expanded={isVisible}
          aria-label={`${isVisible ? 'Hide' : 'Show'} ${columnTitle} section`}
        >
          <h2 className="text-xl font-semibold dark:text-white">
            {columnTitle} <span className="ml-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded-full">{itemCount}</span>
          </h2>
          <svg
            className={`w-6 h-6 transform transition-transform duration-200 ${
              isVisible ? "rotate-0" : "-rotate-90"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isVisible && (
          <SortableContext items={safeItems} strategy={focusedColumn ? verticalListSortingStrategy : rectSortingStrategy}>
            <div className={`min-h-[100px] p-4 ${
              !focusedColumn ? 'grid grid-cols-1 md:grid-cols-3 gap-4' : 'space-y-3'
            }`}>
              {itemCount === 0 ? (
                <DummyDropZone container="ambiguous" />
              ) : (
                <>
                  {safeItems.map((item, index) => {
                    const itemId = typeof item.id === 'string' ? item.id : `ambiguous-${index}`;
                    const safeItem = item.id === itemId ? item : { ...item, id: itemId };
                    const isPendingItem = itemId.startsWith(LOCAL_THOUGHT_PREFIX) || Boolean(item.syncStatus);
                    return (
                      <SortableItem
                        key={itemId}
                        item={safeItem}
                        containerId="ambiguous"
                        onEdit={onEdit}
                        showDeleteIcon={true}
                        onDelete={onDelete}
                        isDeleting={itemId === deletingItemId}
                        activeId={activeId}
                        disabled={isPendingItem}
                      />
                    );
                  })}
                  
                  {/* Additional drop area at the end for consistency */}
                  <div className={`col-span-full ${focusedColumn ? '' : 'md:col-span-3'}`}>
                    <AdditionalDropZone />
                  </div>
                </>
              )}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
};
