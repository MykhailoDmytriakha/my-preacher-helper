import { FileText, Key, Lightbulb, List, Pencil, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import React, { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import TextareaAutosize from "react-textarea-autosize";
import remarkGfm from "remark-gfm";

import { PlanStyle } from "@/api/clients/openAI.client";
import ExportButtons from "@/components/ExportButtons";
import { SwitchViewIcon } from "@/components/Icons";
import KeyFragmentsModal from "@/components/plan/KeyFragmentsModal";
import PlanStyleSelector from "@/components/plan/PlanStyleSelector";
import { ProgressSidebar } from "@/components/plan/ProgressSidebar";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";
import { Plan, Sermon, SermonPoint, Thought } from "@/models/models";
import { sanitizeMarkdown } from "@/utils/markdownUtils";
import { hasPlan } from "@/utils/sermonPlanAccess";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import MarkdownDisplay from "@components/MarkdownDisplay";

import {
  MARKDOWN_SECTION_VARIANT_CLASSES,
  SECTION_NAMES,
  SECTION_TONE_CLASSES,
  TRANSLATION_KEYS,
} from "./constants";
import PlanMarkdownGlobalStyles from "./PlanMarkdownGlobalStyles";

import type {
  CombinedPlan,
  PlanSectionContent,
  RegisterPairedCardRef,
  SectionColors,
  SermonSectionKey,
} from "./types";

const Card = React.forwardRef<HTMLDivElement, { className?: string; children: React.ReactNode }>(
  ({ className, children }, ref) => (
    <div
      ref={ref}
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow ${className || ""}`}
    >
      {children}
    </div>
  )
);
Card.displayName = "Card";

const Button = ({
  onClick,
  variant = "default",
  sectionColor,
  className,
  disabled,
  children,
  title,
}: {
  onClick?: () => void | Promise<void>;
  variant?: "default" | "primary" | "secondary" | "section" | "plan" | "structure";
  sectionColor?: { base: string; light: string; dark: string };
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) => {
  const baseClasses = "px-4 py-2 text-sm font-medium rounded-md transition-colors";
  let variantClass = "";

  if (variant === "section" && sectionColor) {
    variantClass = "text-white section-button";
  } else {
    const variantClasses: Record<string, string> = {
      default: "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
      primary: "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400",
      secondary: "bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-400",
      plan: "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400",
      structure: "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400",
    };
    variantClass = variantClasses[variant] || variantClasses.default;
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClass} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`}
      style={variant === "section" && sectionColor
        ? ({
            backgroundColor: sectionColor.light,
            "--hover-bg": sectionColor.dark,
            "--active-bg": sectionColor.base,
            borderColor: sectionColor.dark,
          } as React.CSSProperties)
        : undefined}
      title={title}
    >
      {children}
    </button>
  );
};

const LoadingSpinner = ({ size = "medium", className = "" }: { size?: "small" | "medium" | "large"; className?: string }) => {
  const sizeClasses = {
    small: "w-4 h-4",
    medium: "w-6 h-6",
    large: "w-10 h-10",
  };

  return (
    <div className={`inline-block animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600 ${sizeClasses[size]} ${className}`} />
  );
};

const SectionHeader = ({ section, onSwitchPage }: { section: SermonSectionKey; onSwitchPage?: () => void }) => {
  const { t } = useTranslation();
  const themeSection = section === "main" ? "mainPart" : section;
  const colors = SERMON_SECTION_COLORS[themeSection as "introduction" | "mainPart" | "conclusion"];
  const sectionToneClasses = SECTION_TONE_CLASSES[section];

  return (
    <div className={`lg:col-span-2 rounded-lg overflow-hidden border ${sectionToneClasses.surface}`}>
      <div
        className={`p-3 border-b border-l-4 ${sectionToneClasses.border} flex justify-between items-start`}
        style={{ borderLeftColor: colors.light }}
      >
        <div>
          <h2 className={`text-xl font-semibold ${sectionToneClasses.text}`}>
            {t(`sections.${section}`)}
          </h2>
        </div>
        {onSwitchPage && (
          <button
            onClick={onSwitchPage}
            className="group p-1 bg-white/20 rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300"
            title={t("plan.switchToStructure", { defaultValue: "Switch to ThoughtsBySection view" })}
            aria-label={t("plan.switchToStructure", { defaultValue: "Switch to ThoughtsBySection view" })}
          >
            <SwitchViewIcon className={`h-4 w-4 ${sectionToneClasses.text} group-hover:text-gray-900 dark:group-hover:text-gray-100`} />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3 px-3 pb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-gray-800 dark:bg-gray-800 dark:text-gray-100 text-xs font-semibold shadow-sm">
            <Lightbulb className="h-4 w-4" />
            {t("plan.columns.thoughts")}
          </span>
        </div>
        <div className="flex items-center justify-start lg:justify-end gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-gray-800 dark:bg-gray-800 dark:text-gray-100 text-xs font-semibold shadow-sm">
            <List className="h-4 w-4" />
            {t("plan.columns.plan")}
          </span>
        </div>
      </div>
    </div>
  );
};

const MarkdownRenderer = ({ markdown, section }: { markdown: string; section?: SermonSectionKey }) => {
  const sectionVariantClass = section ? MARKDOWN_SECTION_VARIANT_CLASSES[section] : "";
  const sanitizedMarkdown = sanitizeMarkdown(markdown);

  return (
    <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content prose-scaled ${sectionVariantClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {sanitizedMarkdown}
      </ReactMarkdown>
    </div>
  );
};

interface PlanMainLayoutContextValue {
  sermon: Sermon;
  planStyle: PlanStyle;
  setPlanStyle: React.Dispatch<React.SetStateAction<PlanStyle>>;
  isLoading: boolean;
  generatingId: string | null;
  registerPairRef: RegisterPairedCardRef;
  generatedContent: Record<string, string>;
  sermonId: string;
  noContentText: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  onGenerate: (outlinePointId: string) => Promise<void>;
  onOpenFragmentsModal: (outlinePointId: string) => void;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSwitchToStructure: () => void;
}

const PlanMainLayoutContext = createContext<PlanMainLayoutContextValue | null>(null);

function usePlanMainLayoutContext() {
  return useContext(PlanMainLayoutContext) as PlanMainLayoutContextValue;
}

interface SermonPointCardProps {
  outlinePoint: SermonPoint;
  thoughts: Thought[];
  sectionName: SermonSectionKey;
}

const SermonPointCard = React.forwardRef<HTMLDivElement, SermonPointCardProps>(({
  outlinePoint,
  thoughts,
  sectionName,
}, ref) => {
  const { t } = useTranslation();
  const {
    onGenerate,
    generatedContent,
    generatingId,
    onOpenFragmentsModal,
  } = usePlanMainLayoutContext();

  const themeSectionName = sectionName === "main" ? "mainPart" : sectionName;
  const sectionColors = SERMON_SECTION_COLORS[themeSectionName as "introduction" | "mainPart" | "conclusion"];
  const sectionToneClasses = SECTION_TONE_CLASSES[sectionName];
  const keyFragmentsCount = thoughts.reduce((count, thought) => count + (thought.keyFragments?.length || 0), 0);
  const currentGeneratedContent = generatedContent[outlinePoint.id] || null;
  const isGenerating = generatingId === outlinePoint.id;

  return (
    <Card
      ref={ref}
      className={`mb-4 p-4 border bg-white dark:bg-gray-800 ${sectionToneClasses.border}`}
    >
      <h3 className={`font-semibold text-lg mb-2 ${sectionToneClasses.text} flex justify-between items-center`}>
        {outlinePoint.text}
        <div className="flex gap-2">
          <Button
            onClick={() => onOpenFragmentsModal(outlinePoint.id)}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8 relative"
            title={t("plan.markKeyFragments")}
          >
            <Key className="h-4 w-4" />
            {keyFragmentsCount > 0 && (
              <span
                className="absolute -top-1 -right-1 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border"
                style={{ borderColor: sectionColors.light }}
              >
                {keyFragmentsCount}
              </span>
            )}
          </Button>
          <Button
            onClick={() => onGenerate(outlinePoint.id)}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8"
            disabled={isGenerating}
            title={isGenerating ? t("plan.generating") : currentGeneratedContent ? t("plan.regenerate") : t("plan.generate")}
          >
            {isGenerating ? <LoadingSpinner size="small" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
      </h3>

      <div className="mb-3">
        <ul className="mt-2 ml-4 text-base">
          {thoughts.map((thought) => (
            <li key={thought.id} className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed text-base flex items-start gap-2">
              <span className="mt-1.5">•</span>
              <div className="flex-1 min-w-0">
                <MarkdownDisplay content={thought.text} compact />
                {thought.keyFragments && thought.keyFragments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {thought.keyFragments.map((fragment, index) => (
                      <span
                        key={index}
                        className="inline-block px-2 py-0.5 text-xs rounded-full"
                        style={{ backgroundColor: sectionColors.light, color: sectionColors.dark }}
                      >
                        &quot;{fragment}&quot;
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {thoughts.length === 0 && (
          <p className="text-base text-gray-500 ml-4">{t("plan.noThoughts")}</p>
        )}
      </div>
    </Card>
  );
});
SermonPointCard.displayName = "SermonPointCard";

interface PlanOutlinePointEditorProps {
  outlinePoint: SermonPoint;
  sectionKey: SermonSectionKey;
  sectionColors: SectionColors;
  sermonPlanSection?: PlanSectionContent;
}

const PlanOutlinePointEditor = React.forwardRef<HTMLDivElement, PlanOutlinePointEditorProps>(({
  outlinePoint,
  sectionKey,
  sectionColors,
  sermonPlanSection,
}, ref) => {
  const {
    generatedContent,
    modifiedContent,
    savedSermonPoints,
    editModePoints,
    noContentText,
    t,
    onSaveSermonPoint,
    onToggleEditMode,
    onSyncPairHeights,
    onUpdateCombinedPlan,
    setGeneratedContent,
    setModifiedContent,
  } = usePlanMainLayoutContext();

  const currentSavedContent = sermonPlanSection?.outlinePoints?.[outlinePoint.id] || "";
  const sectionToneClasses = SECTION_TONE_CLASSES[sectionKey];

  return (
    <div
      ref={ref}
      key={outlinePoint.id}
      className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
    >
      <h3 className={`font-semibold text-lg mb-2 ${sectionToneClasses.text} flex justify-between items-center`}>
        {outlinePoint.text}
        <div className="flex space-x-2">
          <Button
            className="text-sm px-2 py-1 h-8"
            onClick={() => onSaveSermonPoint(
              outlinePoint.id,
              generatedContent[outlinePoint.id] || "",
              sectionKey
            )}
            variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
            sectionColor={modifiedContent[outlinePoint.id] ? sectionColors : undefined}
            disabled={
              !generatedContent[outlinePoint.id] ||
              generatedContent[outlinePoint.id].trim() === "" ||
              (savedSermonPoints[outlinePoint.id] && !modifiedContent[outlinePoint.id])
            }
            title={t("plan.save")}
          >
            <Save className="h-4 w-4" />
          </Button>
        </div>
      </h3>

      <div className="relative">
        <Button
          className="absolute top-2 right-2 z-10 text-sm px-2 py-1 h-8"
          onClick={() => onToggleEditMode(outlinePoint.id)}
          variant="default"
          title={editModePoints[outlinePoint.id] ? t(TRANSLATION_KEYS.PLAN.VIEW_MODE) : t(TRANSLATION_KEYS.PLAN.EDIT_MODE)}
        >
          {editModePoints[outlinePoint.id] ? <FileText className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
        {editModePoints[outlinePoint.id] ? (
          <TextareaAutosize
            className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
            minRows={4}
            placeholder={noContentText}
            value={generatedContent[outlinePoint.id] || ""}
            onChange={(e) => {
              const newContent = e.target.value;
              const isModified = newContent !== currentSavedContent;

              setGeneratedContent((prev) => ({
                ...prev,
                [outlinePoint.id]: newContent,
              }));

              setModifiedContent((prev) => ({
                ...prev,
                [outlinePoint.id]: isModified,
              }));

              onUpdateCombinedPlan(outlinePoint.id, newContent, sectionKey);
              onSyncPairHeights(sectionKey, outlinePoint.id);
            }}
            onHeightChange={() => {
              onSyncPairHeights(sectionKey, outlinePoint.id);
            }}
          />
        ) : (
          <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
            <div className="absolute top-2 right-2 z-10">
              <Button
                className="text-sm px-2 py-1 h-8"
                onClick={() => onToggleEditMode(outlinePoint.id)}
                variant="default"
                title={t(TRANSLATION_KEYS.PLAN.EDIT_MODE)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 pr-12">
              <MarkdownRenderer
                markdown={generatedContent[outlinePoint.id] || noContentText}
                section={sectionKey}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
PlanOutlinePointEditor.displayName = "PlanOutlinePointEditor";

interface PlanSectionColumnsProps {
  sectionKey: SermonSectionKey;
  outlinePoints?: SermonPoint[];
  sectionColors: SectionColors;
  leftTestId: string;
  rightTestId: string;
}

const PlanSectionColumns = ({
  sectionKey,
  outlinePoints,
  sectionColors,
  leftTestId,
  rightTestId,
}: PlanSectionColumnsProps) => {
  const {
    registerPairRef,
    sermon,
    getThoughtsForSermonPoint,
    t,
  } = usePlanMainLayoutContext();

  const points = outlinePoints ?? [];
  const sermonPlanSection = sermon.plan?.[sectionKey];
  const sectionToneClasses = SECTION_TONE_CLASSES[sectionKey];

  return (
    <>
      <div
        data-testid={leftTestId}
        className={`rounded-lg overflow-hidden border ${sectionToneClasses.surface}`}
      >
        <div className="p-3">
          {points.map((outlinePoint) => (
            <SermonPointCard
              key={outlinePoint.id}
              ref={(el) => registerPairRef(sectionKey, outlinePoint.id, "left", el)}
              outlinePoint={outlinePoint}
              thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
              sectionName={sectionKey}
            />
          ))}
          {outlinePoints?.length === 0 && (
            <p className="text-gray-500">{t(TRANSLATION_KEYS.PLAN.NO_SERMON_POINTS)}</p>
          )}
        </div>
      </div>

      <div
        data-testid={rightTestId}
        className={`rounded-lg overflow-hidden border ${sectionToneClasses.surface}`}
      >
        <div className="p-3">
          {points.map((outlinePoint) => (
            <PlanOutlinePointEditor
              key={outlinePoint.id}
              ref={(el) => registerPairRef(sectionKey, outlinePoint.id, "right", el)}
              outlinePoint={outlinePoint}
              sectionKey={sectionKey}
              sectionColors={sectionColors}
              sermonPlanSection={sermonPlanSection}
            />
          ))}
          {outlinePoints?.length === 0 && (
            <p className="text-gray-500">{t(TRANSLATION_KEYS.PLAN.NO_SERMON_POINTS)}</p>
          )}
        </div>
      </div>
    </>
  );
};

interface PlanSectionBlockProps {
  sectionKey: SermonSectionKey;
  outlinePoints?: SermonPoint[];
  sectionColors: SectionColors;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  leftTestId: string;
  rightTestId: string;
  showPlanStyleSelector?: boolean;
}

const PlanSectionBlock = ({
  sectionKey,
  outlinePoints,
  sectionColors,
  sectionRef,
  leftTestId,
  rightTestId,
  showPlanStyleSelector = false,
}: PlanSectionBlockProps) => {
  const {
    planStyle,
    setPlanStyle,
    isLoading,
    generatingId,
    onSwitchToStructure,
  } = usePlanMainLayoutContext();

  return (
    <>
      <div ref={sectionRef} data-section={sectionKey} className="lg:col-span-2">
        {showPlanStyleSelector && (
          <PlanStyleSelector
            value={planStyle}
            onChange={setPlanStyle}
            disabled={isLoading || !!generatingId}
          />
        )}

        <SectionHeader
          section={sectionKey}
          onSwitchPage={onSwitchToStructure}
        />
      </div>
      <PlanSectionColumns
        sectionKey={sectionKey}
        outlinePoints={outlinePoints}
        sectionColors={sectionColors}
        leftTestId={leftTestId}
        rightTestId={rightTestId}
      />
    </>
  );
};

export interface PlanMainLayoutProps {
  sermon: Sermon;
  params: { id: string };
  sermonId: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  combinedPlan: CombinedPlan;
  noContentText: string;
  planStyle: PlanStyle;
  setPlanStyle: React.Dispatch<React.SetStateAction<PlanStyle>>;
  isLoading: boolean;
  generatingId: string | null;
  sectionMenuRef: React.RefObject<HTMLDivElement | null>;
  showSectionMenu: boolean;
  setShowSectionMenu: React.Dispatch<React.SetStateAction<boolean>>;
  registerPairRef: RegisterPairedCardRef;
  introductionSectionRef: React.RefObject<HTMLDivElement | null>;
  mainSectionRef: React.RefObject<HTMLDivElement | null>;
  conclusionSectionRef: React.RefObject<HTMLDivElement | null>;
  generatedContent: Record<string, string>;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  modalSermonPointId: string | null;
  setModalSermonPointId: React.Dispatch<React.SetStateAction<string | null>>;
  findSermonPointById: (outlinePointId: string) => SermonPoint | undefined;
  onThoughtSave: (updatedThought: Thought) => Promise<Thought | void>;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  onGenerate: (outlinePointId: string) => Promise<void>;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSwitchToStructure: () => void;
  onRequestPlanOverlay: () => void;
  onRequestPreachingMode: () => void;
  onStartPreachingMode: () => void;
  getExportContent: (format: "plain" | "markdown") => Promise<string>;
  getPdfContent: () => Promise<React.ReactNode>;
}

export default function PlanMainLayout({
  sermon,
  params,
  sermonId,
  t,
  combinedPlan,
  noContentText,
  planStyle,
  setPlanStyle,
  isLoading,
  generatingId,
  sectionMenuRef,
  showSectionMenu,
  setShowSectionMenu,
  registerPairRef,
  introductionSectionRef,
  mainSectionRef,
  conclusionSectionRef,
  generatedContent,
  modifiedContent,
  savedSermonPoints,
  editModePoints,
  modalSermonPointId,
  setModalSermonPointId,
  findSermonPointById,
  onThoughtSave,
  getThoughtsForSermonPoint,
  onGenerate,
  onSaveSermonPoint,
  onToggleEditMode,
  onSyncPairHeights,
  onUpdateCombinedPlan,
  setGeneratedContent,
  setModifiedContent,
  onSwitchToStructure,
  onRequestPlanOverlay,
  onRequestPreachingMode,
  onStartPreachingMode,
  getExportContent,
  getPdfContent,
}: PlanMainLayoutProps) {
  const introOutline = sermon.outline?.introduction;
  const mainOutline = sermon.outline?.main;
  const conclusionOutline = sermon.outline?.conclusion;

  const contextValue: PlanMainLayoutContextValue = {
    sermon,
    planStyle,
    setPlanStyle,
    isLoading,
    generatingId,
    registerPairRef,
    generatedContent,
    sermonId,
    noContentText,
    t,
    modifiedContent,
    savedSermonPoints,
    editModePoints,
    getThoughtsForSermonPoint,
    onGenerate,
    onOpenFragmentsModal: setModalSermonPointId,
    onSaveSermonPoint,
    onToggleEditMode,
    onSyncPairHeights,
    onUpdateCombinedPlan,
    setGeneratedContent,
    setModifiedContent,
    onSwitchToStructure,
  };

  return (
    <PlanMainLayoutContext.Provider value={contextValue}>
      <div
        className="p-4"
        data-testid="sermon-plan-page-container"
      >
        <ProgressSidebar
          outline={sermon.outline || { introduction: [], main: [], conclusion: [] }}
          savedSermonPoints={savedSermonPoints}
        />
        <PlanMarkdownGlobalStyles variant="main" />
        <div className="w-full">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center">
                <Link
                  href={`/sermons/${params.id}`}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center mr-3"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {t("actions.backToSermon")}
                </Link>
              </div>
            </div>

            {sermon && (
              <div className="mt-6 mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white mb-4">
                  {sermon.title}
                </h1>
                {sermon.verse && (
                  <div className="pl-4 border-l-4 border-blue-500 dark:border-blue-400">
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line text-lg italic">
                      {sermon.verse}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      {t(TRANSLATION_KEYS.COMMON.SCRIPTURE)}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 mt-6">
                  <ViewPlanMenu
                    sermonId={sermonId}
                    combinedPlan={combinedPlan}
                    sectionMenuRef={sectionMenuRef}
                    showSectionMenu={showSectionMenu}
                    setShowSectionMenu={setShowSectionMenu}
                    onRequestPlanOverlay={onRequestPlanOverlay}
                    onRequestPreachingMode={onRequestPreachingMode}
                    onStartPreachingMode={onStartPreachingMode}
                  />

                  <ExportButtons
                    sermonId={sermonId}
                    getExportContent={getExportContent}
                    getPdfContent={getPdfContent}
                    title={sermon.title || "Sermon Plan"}
                    className="ml-auto"
                    disabledFormats={["pdf"]}
                    planData={hasPlan(sermon) ? { ...combinedPlan, sermonTitle: sermon.title, sermonVerse: sermon.verse } : undefined}
                    sermonTitle={sermon.title}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PlanSectionBlock
              sectionKey={SECTION_NAMES.INTRODUCTION}
              outlinePoints={introOutline}
              sectionColors={SERMON_SECTION_COLORS.introduction}
              sectionRef={introductionSectionRef}
              leftTestId="plan-introduction-left-section"
              rightTestId="plan-introduction-right-section"
              showPlanStyleSelector
            />

            <PlanSectionBlock
              sectionKey={SECTION_NAMES.MAIN}
              outlinePoints={mainOutline}
              sectionColors={SERMON_SECTION_COLORS.mainPart}
              sectionRef={mainSectionRef}
              leftTestId="plan-main-left-section"
              rightTestId="plan-main-right-section"
            />

            <PlanSectionBlock
              sectionKey={SECTION_NAMES.CONCLUSION}
              outlinePoints={conclusionOutline}
              sectionColors={SERMON_SECTION_COLORS.conclusion}
              sectionRef={conclusionSectionRef}
              leftTestId="plan-conclusion-left-section"
              rightTestId="plan-conclusion-right-section"
            />
          </div>

          {modalSermonPointId && (() => {
            const outlinePoint = findSermonPointById(modalSermonPointId);
            if (!outlinePoint) return null;
            return (
              <KeyFragmentsModal
                data-testid="key-fragments-modal-instance"
                isOpen={!!modalSermonPointId}
                onClose={() => setModalSermonPointId(null)}
                outlinePoint={outlinePoint}
                thoughts={getThoughtsForSermonPoint(modalSermonPointId)}
                onThoughtSave={onThoughtSave}
              />
            );
          })()}
        </div>
      </div>
    </PlanMainLayoutContext.Provider>
  );
}
