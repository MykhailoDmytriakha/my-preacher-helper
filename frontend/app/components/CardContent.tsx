"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import { Item } from "@/models/models";
import { getTagStyle } from "@/utils/tagUtils";
import MarkdownDisplay from '@components/MarkdownDisplay';
import { normalizeStructureTag } from "@utils/tagUtils";

interface CardContentProps {
  item: Item;
  className?: string;
}

export default function CardContent({ item, className = "" }: CardContentProps) {
  const { t } = useTranslation();

  return (
    <div className={`dark:text-gray-200 ${className}`}>
      <MarkdownDisplay content={item.content} />

      {item.customTagNames && item.customTagNames.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end mt-2">
          {item.customTagNames.map((tag) => {
            // Get display name (translated if available)
            let displayName = tag.name;
            if (tag.translationKey) {
              displayName = t(tag.translationKey);
            } else {
              const canonical = normalizeStructureTag(tag.name);
              if (canonical === 'intro') displayName = t('tags.introduction');
              else if (canonical === 'main') displayName = t('tags.mainPart');
              else if (canonical === 'conclusion') displayName = t('tags.conclusion');
            }

            const { className, style } = getTagStyle(tag.name, tag.color);
            return (
              <span
                key={tag.name}
                style={style}
                className={`text-xs ${className}`}
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