"use client";

import React from "react";

import { OutlinePoint } from "@/models/models";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

interface ProgressSidebarProps {
  outline: {
    introduction: OutlinePoint[];
    main: OutlinePoint[];
    conclusion: OutlinePoint[];
  };
  savedSermonPoints: Record<string, boolean>;
}

export const ProgressSidebar: React.FC<ProgressSidebarProps> = ({
  outline,
  savedSermonPoints,
}) => {
  // Check if dark mode is active
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();
    // Listen for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Calculate total points
  const introPoints = outline.introduction.length;
  const mainPoints = outline.main.length;
  const conclusionPoints = outline.conclusion.length;
  const totalPoints = introPoints + mainPoints + conclusionPoints;

  if (totalPoints === 0) return null;

  // Create section blocks with spacing - using actual section colors from theme
  const sections = [
    {
      name: 'introduction',
      points: outline.introduction,
      savedColor: SERMON_SECTION_COLORS.introduction.light,
      unsavedColor: isDark ? '#374151' : '#e5e7eb' // gray-700 dark : gray-200 light
    },
    {
      name: 'main',
      points: outline.main,
      savedColor: SERMON_SECTION_COLORS.mainPart.light,
      unsavedColor: isDark ? '#374151' : '#e5e7eb' // gray-700 dark : gray-200 light
    },
    {
      name: 'conclusion',
      points: outline.conclusion,
      savedColor: SERMON_SECTION_COLORS.conclusion.light,
      unsavedColor: isDark ? '#374151' : '#e5e7eb' // gray-700 dark : gray-200 light
    }
  ].filter(section => section.points.length > 0);

  return (
    <div className="fixed left-4 top-1/2 z-50 flex flex-col gap-4 transform -translate-y-1/2">
      {sections.map((section, _sectionIndex) => (
        <div key={section.name} className="flex flex-col gap-0.5">
            {section.points.map((point, _pointIndex) => (
              <div
                key={point.id}
                className={`
                  w-3 h-3 rounded-sm transition-all duration-300 border
                  ${savedSermonPoints[point.id]
                    ? 'shadow-sm'
                    : 'border-gray-300 dark:border-gray-600'
                  }
                `}
                style={{
                  backgroundColor: savedSermonPoints[point.id] ? section.savedColor : section.unsavedColor,
                  borderColor: savedSermonPoints[point.id] ? 'transparent' : undefined
                }}
                title={`${point.text} - ${savedSermonPoints[point.id] ? 'Сохранено' : 'Не сохранено'}`}
              />
            ))}
        </div>
      ))}
    </div>
  );
};