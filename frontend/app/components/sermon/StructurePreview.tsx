"use client";

import React, { useState, useEffect } from "react";
import type { Sermon, Thought } from "@/models/models";
import { useTranslation } from 'react-i18next';

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
  const introColor = "#2563eb";
  const mainColor = "#7e22ce";
  const conclusionColor = "#16a34a";

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
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className={`h-5 w-5 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {!isCollapsed && (
        <div className="space-y-4">
          {sermon.structure.introduction && sermon.structure.introduction.length > 0 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 hover:shadow-md transition-all">
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: introColor }}></div>
                <strong className="text-blue-700 dark:text-blue-400">{t('tags.introduction')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.introduction.map((item, index) => (
                  <span key={`intro-${index}`} className="inline-block px-2 py-0.5 bg-blue-100 dark:bg-blue-800/40 rounded m-0.5 whitespace-pre-wrap">
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {sermon.structure.main && sermon.structure.main.length > 0 && (
            <div className="p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-100 dark:border-violet-800 hover:shadow-md transition-all">
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: mainColor }}></div>
                <strong className="text-violet-700 dark:text-violet-400">{t('tags.mainPart')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.main.map((item, index) => (
                  <span key={`main-${index}`} className="inline-block px-2 py-0.5 bg-violet-100 dark:bg-violet-800/40 rounded m-0.5 whitespace-pre-wrap">
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {sermon.structure.conclusion && sermon.structure.conclusion.length > 0 && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-800 hover:shadow-md transition-all">
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: conclusionColor }}></div>
                <strong className="text-green-700 dark:text-green-400">{t('tags.conclusion')}</strong>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                {sermon.structure.conclusion.map((item, index) => (
                  <span key={`conclusion-${index}`} className="inline-block px-2 py-0.5 bg-green-100 dark:bg-green-800/40 rounded m-0.5 whitespace-pre-wrap">
                    {getThoughtTextById(item)}
                  </span>
                ))}
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