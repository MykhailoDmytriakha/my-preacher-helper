"use client";

// External libraries
import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';

// Path alias imports
import type { Sermon, Thought } from "@/models/models";
import { ChevronIcon } from '@components/Icons';
import { SERMON_SECTION_COLORS, getTagStyling } from '@/utils/themeColors'; // Import the central theme

interface StructurePreviewProps {
  sermon: Sermon;
  animateEntry?: boolean;
}

const StructurePreview: React.FC<StructurePreviewProps> = ({
  sermon,
  animateEntry = true
}) => {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [animate, setAnimate] = useState(false);
  
  // Set animation state after component mounts
  useEffect(() => {
    if (animateEntry) {
      const timer = setTimeout(() => {
        setAnimate(true);
      }, 100);
      
      return () => clearTimeout(timer);
    } else {
      setAnimate(true);
    }
  }, [animateEntry]);

  // Function to find thought text by ID
  const getThoughtTextById = (thoughtId: string): string => {
    if (!sermon.thoughts) return thoughtId;
    
    const thought = sermon.thoughts.find((t: Thought) => t.id === thoughtId);
    return thought ? thought.text.slice(0, 100) + '...' : thoughtId;
  };

  // Default colors
  const introColor = SERMON_SECTION_COLORS.introduction.base;
  const mainColor = SERMON_SECTION_COLORS.mainPart.base;
  const conclusionColor = SERMON_SECTION_COLORS.conclusion.base;

  if (!sermon.structure) return null;

  return (
    <div className={`p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 transition-all hover:shadow-lg ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`} 
        style={{ transitionDelay: '400ms' }}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          {t('structure.preview')}
        </h3>
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          <ChevronIcon 
            className={isCollapsed ? 'rotate-180' : ''} 
          />
        </button>
      </div>
      
      {!isCollapsed && (
        <div className="space-y-4">
          {sermon.structure.introduction && sermon.structure.introduction.length > 0 && (
            <div className={`p-3 rounded-lg hover:shadow-md transition-all ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg} border ${SERMON_SECTION_COLORS.introduction.border} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: introColor }}></div>
                <strong className={`${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`}>{t('tags.introduction')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.introduction.map((item, index) => {
                  const tag = getTagStyling('introduction');
                  return (
                  <span key={`intro-${index}`} className={`inline-block px-2 py-0.5 rounded m-0.5 whitespace-pre-wrap ${tag.bg} ${tag.text}`}>
                    {getThoughtTextById(item)}
                  </span>
                );})}
              </div>
            </div>
          )}
          
          {sermon.structure.main && sermon.structure.main.length > 0 && (
            <div className={`p-3 rounded-lg hover:shadow-md transition-all ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg} border ${SERMON_SECTION_COLORS.mainPart.border} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: mainColor }}></div>
                <strong className={`${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`}>{t('tags.mainPart')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.main.map((item, index) => {
                  const tag = getTagStyling('mainPart');
                  return (
                  <span key={`main-${index}`} className={`inline-block px-2 py-0.5 rounded m-0.5 whitespace-pre-wrap ${tag.bg} ${tag.text}`}>
                    {getThoughtTextById(item)}
                  </span>
                );})}
              </div>
            </div>
          )}
          
          {sermon.structure.conclusion && sermon.structure.conclusion.length > 0 && (
            <div className={`p-3 rounded-lg hover:shadow-md transition-all ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg} border ${SERMON_SECTION_COLORS.conclusion.border} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: conclusionColor }}></div>
                <strong className={`${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`}>{t('tags.conclusion')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.conclusion.map((item, index) => {
                  const tag = getTagStyling('conclusion');
                  return (
                  <span key={`conclusion-${index}`} className={`inline-block px-2 py-0.5 rounded m-0.5 whitespace-pre-wrap ${tag.bg} ${tag.text}`}>
                    {getThoughtTextById(item)}
                  </span>
                );})}
              </div>
            </div>
          )}
          
          {sermon.structure.ambiguous && sermon.structure.ambiguous.length > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all">
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2 bg-gray-400"></div>
                <strong className="text-gray-700 dark:text-gray-300">{t('structure.underConsideration')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.ambiguous.map((item, index) => (
                  <span key={`ambiguous-${index}`} className="inline-block px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded m-0.5">
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StructurePreview; 