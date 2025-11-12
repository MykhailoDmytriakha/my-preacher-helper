"use client";
import { useState } from 'react';
import React from 'react';
import { Sermon } from "@/models/models";
import { ChevronIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";
import { Series } from "@/models/models";
import SermonCard from "./SermonCard";

interface SermonListProps {
  sermons: Sermon[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  series?: Series[];
  isMultiSelectMode?: boolean;
  selectedSermonIds?: Set<string>;
  onToggleSermonSelection?: (sermonId: string) => void;
}

export default function SermonList({
  sermons,
  onDelete,
  onUpdate,
  series = [],
  isMultiSelectMode = false,
  selectedSermonIds = new Set(),
  onToggleSermonSelection
}: SermonListProps) {
  const { t } = useTranslation();
  const [isPreachedCollapsed, setIsPreachedCollapsed] = useState(false);

  const firstPreachedIndex = sermons.findIndex(s => s.isPreached);
  const hasPreachedSermons = firstPreachedIndex !== -1;

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {sermons.map((sermon, index) => {
        const isFirstPreached = hasPreachedSermons && index === firstPreachedIndex;
        
        return (
          <React.Fragment key={sermon.id}>
            {isFirstPreached && (
              <div 
                className="col-span-full mt-6 mb-2 flex items-center cursor-pointer pt-4"
                onClick={() => setIsPreachedCollapsed(!isPreachedCollapsed)}
              >
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400 mr-2">
                  {t('dashboard.preached')}
                </span>
                <ChevronIcon 
                  direction={isPreachedCollapsed ? 'down' : 'up'} 
                  className="w-4 h-4 text-gray-500"
                />
                <div className="flex-grow border-t border-gray-300 dark:border-gray-600 ml-2"></div>
              </div>
            )}

            {(!sermon.isPreached || (sermon.isPreached && !isPreachedCollapsed)) && (
              <SermonCard
                          sermon={sermon}
                series={series}
                onDelete={onDelete}
                          onUpdate={onUpdate}
                isMultiSelectMode={isMultiSelectMode}
                selectedSermonIds={selectedSermonIds}
                onToggleSermonSelection={onToggleSermonSelection}
                      />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
