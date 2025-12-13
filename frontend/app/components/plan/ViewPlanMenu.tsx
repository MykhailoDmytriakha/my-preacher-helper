import { BookOpen, ChevronDown, ScrollText } from "lucide-react";
import React from "react";
import ReactDOM from "react-dom/client";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sanitizeMarkdown } from "@/utils/markdownUtils";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

import { getPlanMarkdownStyles } from './markdownStyles';


interface ViewPlanMenuProps {
  sermonTitle: string;
  sermonId: string;
  combinedPlan: {
    introduction: string;
    main: string;
    conclusion: string;
  };
  sectionMenuRef: React.RefObject<HTMLDivElement | null>;
  showSectionMenu: boolean;
  setShowSectionMenu: (show: boolean) => void;
  onRequestPlanOverlay: () => void;
  onRequestPreachingMode?: () => void;
  onStartPreachingMode?: () => void;
}

interface MarkdownRendererProps {
  markdown: string;
  section?: 'introduction' | 'main' | 'conclusion';
}

const MarkdownRenderer = ({ markdown, section }: MarkdownRendererProps) => {
  const sectionClass = section ? `prose-${section}` : '';
  const sectionDivClass = section ? `${section}-section` : '';
  
  // Sanitize the markdown content
  const sanitizedMarkdown = sanitizeMarkdown(markdown);

  return (
    <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content ${sectionClass} ${sectionDivClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {sanitizedMarkdown}
      </ReactMarkdown>
    </div>
  );
};

const ViewPlanMenu: React.FC<ViewPlanMenuProps> = ({
  sermonTitle,
  sermonId,
  combinedPlan,
  sectionMenuRef,
  showSectionMenu,
  setShowSectionMenu,
  onRequestPlanOverlay,
  onRequestPreachingMode,
  onStartPreachingMode,
}) => {
  const { t } = useTranslation();

  const openSectionModal = (section: 'introduction' | 'main' | 'conclusion') => {
    setShowSectionMenu(false);
    
    // Map to canonical section colors
    const getSectionColors = (sec: 'introduction' | 'main' | 'conclusion') => {
      const colors = sec === 'main' ? SERMON_SECTION_COLORS.mainPart : SERMON_SECTION_COLORS[sec];
      return colors;
    };
    
    const sectionContent = combinedPlan[section] || t("plan.noContent");
    const sectionTitle = t(`sections.${section}`);
    
    // Create a modal for viewing the section
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    
    // Create the content container
    const content = document.createElement('div');
    content.className = 'bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto p-6 shadow-lg';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-4';
    
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold';
    title.textContent = `${t("plan.pageTitle")} - ${sectionTitle}`;
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'flex gap-2';
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-gray-600 text-white hover:bg-gray-700';
    closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    closeButton.title = t("actions.close") || "Close";
    
    closeButton.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    buttonsContainer.appendChild(closeButton);
    header.appendChild(title);
    header.appendChild(buttonsContainer);
    
    content.appendChild(header);
    modal.appendChild(content);
    
    // Add markdown content
    const markdownContent = document.createElement('div');
    markdownContent.className = 'prose dark:prose-invert max-w-none mb-4';
    // Inject consistent markdown styles
    const styleEl = document.createElement('style');
    styleEl.innerHTML = getPlanMarkdownStyles();
    content.appendChild(styleEl);
    
    // Create content wrapper with vertical border
    const contentWrapper = document.createElement('div');
    {
      const sc = getSectionColors(section);
      contentWrapper.className = `pl-2 border-l-4 ${sc.border.split(' ')[0]} dark:${sc.darkBorder} prose-${section}`;
    }
    
    // Render React component inside the div
    const root = ReactDOM.createRoot(markdownContent);
    root.render(
      <MarkdownRenderer 
        markdown={sectionContent} 
        section={section}
      />
    );
    
    contentWrapper.appendChild(markdownContent);
    content.appendChild(contentWrapper);
    modal.appendChild(content);
    document.body.appendChild(modal);
  };

  return (
    <div className="flex gap-2" ref={sectionMenuRef}>
      <div className="relative">
        <button
          onClick={() => setShowSectionMenu(!showSectionMenu)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700"
        >
          <BookOpen className="h-6 w-6" />
          {t("plan.viewPlan") || "View Plan"}
          <ChevronDown className="h-4 w-4 ml-1" />
        </button>
      
      {showSectionMenu && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-30 min-w-[180px]">
          <button 
            className={`w-full text-left px-4 py-2 ${SERMON_SECTION_COLORS.introduction.hover} dark:${SERMON_SECTION_COLORS.introduction.darkHover} ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} flex items-center`}
            onClick={() => openSectionModal('introduction')}
          >
            <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: SERMON_SECTION_COLORS.introduction.base }}></div>
            {t("sections.introduction")}
          </button>
          
          <button 
            className={`w-full text-left px-4 py-2 ${SERMON_SECTION_COLORS.mainPart.hover} dark:${SERMON_SECTION_COLORS.mainPart.darkHover} ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} flex items-center`}
            onClick={() => openSectionModal('main')}
          >
            <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: SERMON_SECTION_COLORS.mainPart.base }}></div>
            {t("sections.main")}
          </button>
          
          <button 
            className={`w-full text-left px-4 py-2 ${SERMON_SECTION_COLORS.conclusion.hover} dark:${SERMON_SECTION_COLORS.conclusion.darkHover} ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} flex items-center`}
            onClick={() => openSectionModal('conclusion')}
          >
            <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: SERMON_SECTION_COLORS.conclusion.base }}></div>
            {t("sections.conclusion")}
          </button>
          
          <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
          
          <button 
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-300 flex items-center"
            onClick={() => {
              setShowSectionMenu(false);
              onRequestPlanOverlay();
            }}
          >
            <ScrollText className="h-8 w-8 mr-2" />
            {t("plan.viewFullPlan") || "Full Plan"}
          </button>
        </div>
      )}
      </div>

      <button
        onClick={() => {
          if (onStartPreachingMode) {
            onStartPreachingMode();
          } else if (onRequestPreachingMode) {
            onRequestPreachingMode();
          } else {
            window.location.href = `/sermons/${sermonId}/plan?planView=preaching`;
          }
        }}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-green-600 text-white hover:bg-green-700"
      >
        <ScrollText className="h-6 w-6" />
        {t("plan.preachButton") || "Preach"}
      </button>
    </div>
  );
};

export default ViewPlanMenu; 
