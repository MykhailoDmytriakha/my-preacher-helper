"use client";

import React from "react";
import { getContrastColor } from "@/utils/color";
import { Item } from "@/models/models";
import { useTranslation } from "react-i18next";

interface CardContentProps {
  item: Item;
  className?: string;
}

export default function CardContent({ item, className = "" }: CardContentProps) {
  const { t } = useTranslation();
  
  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {/* Display outline point if available */}
      {item.outlinePoint && (
        <div className="mb-2">
          <span className="text-sm inline-block rounded-md px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800">
            {item.outlinePoint.section ? `${item.outlinePoint.section}: ${item.outlinePoint.text}` : item.outlinePoint.text}
          </span>
        </div>
      )}
      
      {item.content}
      
      {item.customTagNames && item.customTagNames.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end mt-2">
          {item.customTagNames.map((tag) => {
            // Get display name (translated if available)
            let displayName = tag.name;
            if (tag.translationKey) {
              displayName = t(tag.translationKey);
            } else if (tag.name.toLowerCase() === "intro" || tag.name.toLowerCase() === "вступление") {
              displayName = t('tags.introduction');
            } else if (tag.name.toLowerCase() === "main" || tag.name.toLowerCase() === "основная часть") {
              displayName = t('tags.mainPart');
            } else if (tag.name.toLowerCase() === "conclusion" || tag.name.toLowerCase() === "заключение") {
              displayName = t('tags.conclusion');
            }
            
            return (
              <span 
                key={tag.name}
                style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                className="text-xs text-white px-2 py-1 rounded-full"
              >
                {displayName}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
} 