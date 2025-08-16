import React from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown, ScrollText } from "lucide-react";
import ReactDOM from "react-dom/client";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getPlanMarkdownStyles } from './markdownStyles';


interface ViewPlanMenuProps {
  sermonTitle: string;
  sermonVerse?: string;
  combinedPlan: {
    introduction: string;
    main: string;
    conclusion: string;
  };
  sectionMenuRef: React.RefObject<HTMLDivElement | null>;
  showSectionMenu: boolean;
  setShowSectionMenu: (show: boolean) => void;
}

interface MarkdownRendererProps {
  markdown: string;
  section?: 'introduction' | 'main' | 'conclusion';
}

const MarkdownRenderer = ({ markdown, section }: MarkdownRendererProps) => {
  const sectionClass = section ? `prose-${section}` : '';
  const sectionDivClass = section ? `${section}-section` : '';

  return (
    <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content ${sectionClass} ${sectionDivClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
};

const ViewPlanMenu: React.FC<ViewPlanMenuProps> = ({
  sermonTitle,
  sermonVerse,
  combinedPlan,
  sectionMenuRef,
  showSectionMenu,
  setShowSectionMenu,
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

  const openFullPlanModal = () => {
    setShowSectionMenu(false);
    
    // Create a modal for viewing the full plan
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    
    // Create the content container
    const content = document.createElement('div');
    content.className = 'bg-white dark:bg-gray-800 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto p-6 shadow-lg';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-4';
    
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold';
    title.textContent = `${t("plan.pageTitle")} - ${sermonTitle}`;
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'flex gap-2';
    
    // Create fullscreen button
    const fullscreenButton = document.createElement('button');
    fullscreenButton.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-gray-600 text-white hover:bg-gray-700';
    fullscreenButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
    fullscreenButton.title = t("plan.fullscreen") || "Fullscreen";
    
    // Flag to track fullscreen state
    let isFullscreen = false;
    
    fullscreenButton.addEventListener('click', () => {
      isFullscreen = !isFullscreen;
      
      if (isFullscreen) {
        // Enter fullscreen mode
        content.classList.remove('max-w-5xl', 'max-h-[90vh]');
        content.classList.add('w-screen', 'h-screen', 'max-w-none', 'max-h-none', 'rounded-none');
        modal.classList.remove('p-4');
        
        // Update button icon to show minimize
        fullscreenButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        fullscreenButton.title = t("plan.exitFullscreen") || "Exit Fullscreen";
      } else {
        // Exit fullscreen mode
        content.classList.add('max-w-5xl', 'max-h-[90vh]');
        content.classList.remove('w-screen', 'h-screen', 'max-w-none', 'max-h-none', 'rounded-none');
        modal.classList.add('p-4');
        
        // Update button icon to show maximize
        fullscreenButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        fullscreenButton.title = t("plan.fullscreen") || "Fullscreen";
      }
    });
    
    buttonsContainer.appendChild(fullscreenButton);
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-gray-600 text-white hover:bg-gray-700';
    closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    closeButton.title = t("actions.close") || "Close";
    
    closeButton.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    buttonsContainer.appendChild(closeButton);
    
    // Create copy button
    const copyButton = document.createElement('button');
    copyButton.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700';
    copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>${t("copy.copyFormatted") || "Copy Formatted"}</span>`;
    
    copyButton.addEventListener('click', () => {
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      // Clone the formatted content and append to tempDiv
      const contentToCopy = markdownContent.cloneNode(true); 
      tempDiv.appendChild(contentToCopy);
      
      // Append to body BEFORE trying to copy
      document.body.appendChild(tempDiv);
      
      const originalButtonHtml = copyButton.innerHTML;
      const copiedHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/></svg><span>${t("common.copied") || "Copied!"}</span>`;
      
      const showCopiedState = () => {
        copyButton.innerHTML = copiedHtml;
        copyButton.classList.add('bg-green-600', 'hover:bg-green-700');
        copyButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        copyButton.disabled = true;
        setTimeout(() => {
          copyButton.innerHTML = originalButtonHtml;
          copyButton.classList.remove('bg-green-600', 'hover:bg-green-700');
          copyButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
          copyButton.disabled = false;
        }, 1500);
      };

      try {
        // Execute copy command (or use clipboard API)
        const successful = document.execCommand('copy');
        if (successful) {
          showCopiedState();
        } else {
          navigator.clipboard.writeText(tempDiv.innerText)
            .then(() => {
              showCopiedState();
              toast.success(t("plan.copySuccess") || "Plan copied to clipboard!");
            })
            .catch(err => {
              toast.error(t("plan.copyError") || "Failed to copy");
              console.error('Copy error:', err);
            });
        }
      } catch {
        navigator.clipboard.writeText(tempDiv.innerText)
          .then(() => {
            showCopiedState();
            toast.success(t("plan.copySuccess") || "Plan copied to clipboard!");
          })
          .catch(() => {
            toast.error(t("plan.copyError") || "Failed to copy");
          });
      }
      
      // Cleanup (now tempDiv should be a child)
      document.body.removeChild(tempDiv);
    });
    
    buttonsContainer.appendChild(copyButton);
    
    header.appendChild(title);
    header.appendChild(buttonsContainer);
    
    content.appendChild(header);
    modal.appendChild(content);
    
    // Add markdown content
    const markdownContent = document.createElement('div');
    markdownContent.className = 'prose dark:prose-invert max-w-none';
    // Inject consistent markdown styles
    const styleEl = document.createElement('style');
    styleEl.innerHTML = getPlanMarkdownStyles();
    content.appendChild(styleEl);
    
    // Render React component inside the div
    const root = ReactDOM.createRoot(markdownContent);
    
    // Combine all sections in a full plan view
    root.render(
      <>
        {sermonVerse && (
          <div className={`mb-8 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
            <p className="text-gray-700 dark:text-gray-300 italic text-lg whitespace-pre-line">
              {sermonVerse}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              {t("common.scripture")}
            </p>
          </div>
        )}
        
        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
            {t("sections.introduction")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} prose-introduction`}>
            <MarkdownRenderer 
              markdown={combinedPlan.introduction || t("plan.noContent")} 
              section="introduction"
            />
          </div>
        </div>
        
        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
            {t("sections.main")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} prose-main`}>
            <MarkdownRenderer 
              markdown={combinedPlan.main || t("plan.noContent")} 
              section="main"
            />
          </div>
        </div>
        
        <div className="mb-4">
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
            {t("sections.conclusion")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} prose-conclusion`}>
            <MarkdownRenderer 
              markdown={combinedPlan.conclusion || t("plan.noContent")} 
              section="conclusion"
            />
          </div>
        </div>
      </>
    );
    
    content.appendChild(markdownContent);
    modal.appendChild(content);
    document.body.appendChild(modal);
  };

  return (
    <div className="relative" ref={sectionMenuRef}>
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
            onClick={openFullPlanModal}
          >
            <ScrollText className="h-8 w-8 mr-2" />
            {t("plan.viewFullPlan") || "Full Plan"}
          </button>
        </div>
      )}
    </div>
  );
};

export default ViewPlanMenu; 