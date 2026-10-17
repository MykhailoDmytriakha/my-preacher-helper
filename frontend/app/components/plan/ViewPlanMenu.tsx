import { BookOpen, ChevronDown, ScrollText } from "lucide-react";
import React from "react";

import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { useTranslation } from "@locales/useTranslation";

import PlanSectionDialog, { type PlanSection } from './PlanSectionDialog';


interface ViewPlanMenuProps {
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

const ViewPlanMenu: React.FC<ViewPlanMenuProps> = ({
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

  const [selectedSection, setSelectedSection] = React.useState<PlanSection | null>(null);
  const viewButtonRef = React.useRef<HTMLButtonElement>(null);

  const openSectionModal = (section: PlanSection) => {
    setShowSectionMenu(false);
    setSelectedSection(section);
  };
  const closeSectionModal = () => {
    setSelectedSection(null);
    viewButtonRef.current?.focus();
  };

  return (
    <>
    <div className="flex flex-wrap gap-2" ref={sectionMenuRef}>
      <div className="relative w-full sm:w-auto">
        <button
          ref={viewButtonRef}
          onClick={() => setShowSectionMenu(!showSectionMenu)}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700 w-full sm:w-auto"
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
        className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-green-600 text-white hover:bg-green-700 w-full sm:w-auto"
      >
        <ScrollText className="h-6 w-6" />
        {t("plan.preachButton") || "Preach"}
      </button>
    </div>
    {selectedSection && (
      <PlanSectionDialog section={selectedSection} markdown={combinedPlan[selectedSection]} onClose={closeSectionModal} />
    )}
    </>
  );
};

export default ViewPlanMenu; 
