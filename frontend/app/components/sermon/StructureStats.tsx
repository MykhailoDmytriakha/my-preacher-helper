"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import type { Sermon, Thought } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface StructureStatsProps {
  sermon: Sermon;
  tagCounts: {
    [key: string]: number;
  };
  totalThoughts: number;
}

const StructureStats: React.FC<StructureStatsProps> = ({
  sermon,
  tagCounts,
  totalThoughts,
}) => {
  const router = useRouter();
  const { id } = useParams() as { id: string };
  const { t } = useTranslation();
  const [animateStats, setAnimateStats] = useState(false);
  
  // Set animation state after component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimateStats(true);
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Function to find thought text by ID
  const getThoughtTextById = (thoughtId: string): string => {
    if (!sermon.thoughts) return thoughtId;
    
    const thought = sermon.thoughts.find((t: Thought) => t.id === thoughtId);
    return thought ? thought.text : thoughtId;
  };

  const intro = tagCounts["Вступление"] || 0;
  const main = tagCounts["Основная часть"] || 0;
  const conclusion = tagCounts["Заключение"] || 0;

  const introPercentage = totalThoughts
    ? Math.round((intro / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((main / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((conclusion / totalThoughts) * 100)
    : 0;

  // Default colors
  const introColor = "#2563eb";
  const mainColor = "#7e22ce";
  const conclusionColor = "#16a34a";

  return (
    <div className="space-y-6">
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold mb-4">{t('structure.title')}</h2>
        <div className="space-y-4">
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
            <div className="absolute inset-0 flex">
              <div
                className="transition-all duration-500"
                style={{
                  width: totalThoughts ? `${introPercentage}%` : "0%",
                  backgroundColor: introColor,
                }}
                data-tooltip={`${t('tags.introduction')}: ${intro} ${t('structure.entries')}`}
              />
              <div
                className="transition-all duration-500"
                style={{
                  width: totalThoughts ? `${mainPercentage}%` : "0%",
                  backgroundColor: mainColor,
                }}
                data-tooltip={`${t('tags.mainPart')}: ${main} ${t('structure.entries')}`}
              />
              <div
                className="transition-all duration-500"
                style={{
                  width: totalThoughts ? `${conclusionPercentage}%` : "0%",
                  backgroundColor: conclusionColor,
                }}
                data-tooltip={`${t('tags.conclusion')}: ${conclusion} ${t('structure.entries')}`}
              />
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <div className="text-center" style={{ color: introColor }}>
              <div className="text-lg font-bold">{introPercentage}%</div>
              <span className="text-xs text-gray-500">
                "{t('tags.introduction')}" <br />
                {t('structure.recommended', { percent: 20 })}
              </span>
            </div>
            <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
            <div className="text-center" style={{ color: mainColor }}>
              <div className="text-lg font-bold">{mainPercentage}%</div>
              <span className="text-xs text-gray-500">
                "{t('tags.mainPart')}"
                <br />
                {t('structure.recommended', { percent: 60 })}
              </span>
            </div>
            <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
            <div className="text-center" style={{ color: conclusionColor }}>
              <div className="text-lg font-bold">{conclusionPercentage}%</div>
              <span className="text-xs text-gray-500">
                "{t('tags.conclusion')}" <br />
                {t('structure.recommended', { percent: 20 })}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => router.push(`/structure?sermonId=${sermon.id}`)}
          className="w-full mt-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          {t('structure.workButton')}
        </button>
      </div>
      {sermon.structure && (
        <div className={`p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 transition-all hover:shadow-lg ${animateStats ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`} style={{ transitionDelay: '400ms' }}>
          <h3 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            {t('structure.preview')}
          </h3>
          
          <div className="space-y-4">
            {sermon.structure.introduction && sermon.structure.introduction.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 hover:shadow-md transition-all">
                <div className="flex items-center mb-2">
                  <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: introColor }}></div>
                  <strong className="text-blue-700 dark:text-blue-400">{t('tags.introduction')}</strong>
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300 font-medium ml-5">
                  {sermon.structure.introduction.map((item, index) => (
                    <span key={`intro-${index}`} className="inline-block px-2 py-0.5 bg-blue-100 dark:bg-blue-800/40 rounded m-0.5">
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
                    <span key={`main-${index}`} className="inline-block px-2 py-0.5 bg-violet-100 dark:bg-violet-800/40 rounded m-0.5">
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
                    <span key={`conclusion-${index}`} className="inline-block px-2 py-0.5 bg-green-100 dark:bg-green-800/40 rounded m-0.5">
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
        </div>
      )}
    </div>
  );
};

export default StructureStats;
