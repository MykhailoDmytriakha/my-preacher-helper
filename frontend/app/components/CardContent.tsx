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
  locationContext?: {
    subPointText?: string | null;
  };
}

export default function CardContent({ item, className = "", locationContext }: CardContentProps) {
  const { t } = useTranslation();
  const subPointBadgeText = locationContext?.subPointText?.trim() || null;
  const hasTags = Boolean(
    (item.customTagNames && item.customTagNames.length > 0) ||
    (item.requiredTags && item.requiredTags.length > 0)
  );

  return (
    <div className={`dark:text-gray-200 ${className}`}>
      <MarkdownDisplay content={item.content} />

      {(subPointBadgeText || hasTags) && (
        <div className={`mt-3 flex flex-wrap items-end gap-2 ${subPointBadgeText ? "justify-between" : "justify-end"}`}>
          {subPointBadgeText && (
            <span
              data-testid="thought-location-chip"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50/90 px-2 py-0.5 text-[10px] font-semibold leading-4 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
            >
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
              <span className="truncate">{subPointBadgeText}</span>
            </span>
          )}

          {hasTags && (
            <div className="flex flex-wrap justify-end gap-1">
              {item.requiredTags?.map((tag) => {
                const canonical = normalizeStructureTag(tag);
                if (!canonical) return null;

                let displayName = tag;
                if (canonical === 'intro') displayName = t('tags.introduction');
                else if (canonical === 'main') displayName = t('tags.mainPart');
                else if (canonical === 'conclusion') displayName = t('tags.conclusion');

                const { className, style } = getTagStyle(tag);
                return (
                  <span
                    key={`required-${tag}`}
                    style={style}
                    className={`text-xs ${className}`}
                  >
                    {displayName}
                  </span>
                );
              })}

              {item.customTagNames?.map((tag) => {
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
                    key={`custom-${tag.name}`}
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
      )}
    </div>
  );
}
