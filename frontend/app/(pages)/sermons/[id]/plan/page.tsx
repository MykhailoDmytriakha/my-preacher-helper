"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSermonById } from "@/services/sermon.service";
import { Outline, OutlinePoint, Plan, Sermon, Thought, Structure } from "@/models/models";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import TextareaAutosize from "react-textarea-autosize";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import Link from "next/link";
import React from "react";
import { Save, Sparkles, FileText, Pencil, Key, Maximize2, BookOpen, X, ChevronDown, Copy, Minimize2, ScrollText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import KeyFragmentsModal from "@/components/plan/KeyFragmentsModal";
import ReactDOM from "react-dom/client";
import ExportButtons from "@/components/ExportButtons";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";

// Стиль для hover-эффекта кнопок с секционными цветами
const sectionButtonStyles = `
  .section-button {
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }
  .section-button:hover {
    background-color: var(--hover-bg) !important;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .section-button:active {
    transform: translateY(0);
    background-color: var(--active-bg) !important;
    box-shadow: none;
  }
`;

// Custom UI components
const Card = React.forwardRef<HTMLDivElement, { className?: string, children: React.ReactNode }>(
  ({ className, children }, ref) => (
    <div 
      ref={ref}
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow ${className || ''}`}
    >
      {children}
    </div>
  )
);

const Button = ({ 
  onClick, 
  variant = "default", 
  sectionColor,
  className, 
  disabled, 
  children,
  title
}: { 
  onClick?: () => void, 
  variant?: "default" | "primary" | "secondary" | "section", 
  sectionColor?: { base: string, light: string, dark: string },
  className?: string, 
  disabled?: boolean, 
  children: React.ReactNode,
  title?: string
}) => {
  const baseClasses = "px-4 py-2 text-sm font-medium rounded-md transition-colors";
  
  let variantClass = "";
  
  if (variant === "section" && sectionColor) {
    // Для секционных стилей используем базовый класс без цветов,
    // цвета будут применены через inline-стили
    variantClass = "text-white section-button";
  } else {
    const variantClasses: Record<string, string> = {
      default: "bg-gray-200 text-gray-800 hover:bg-gray-300",
      primary: "bg-blue-600 text-white hover:bg-blue-700",
      secondary: "bg-gray-600 text-white hover:bg-gray-700"
    };
    variantClass = variantClasses[variant] || variantClasses.default;
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className || ''}`}
      style={variant === "section" && sectionColor ? {
        backgroundColor: sectionColor.light,
        "--hover-bg": sectionColor.dark,
        "--active-bg": sectionColor.base,
        // Создаем более темный цвет для border
        borderColor: sectionColor.dark,
      } as React.CSSProperties : undefined}
      title={title}
    >
      {children}
    </button>
  );
};

const LoadingSpinner = ({ size = "medium", className = "" }: { size?: "small" | "medium" | "large", className?: string }) => {
  const sizeClasses = {
    small: "w-4 h-4",
    medium: "w-6 h-6",
    large: "w-10 h-10"
  };
  
  return (
    <div className={`inline-block animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600 ${sizeClasses[size]} ${className}`}></div>
  );
};

const MarkdownRenderer = ({ markdown, section }: { markdown: string, section?: 'introduction' | 'main' | 'conclusion' }) => {
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

interface OutlinePointCardProps {
  outlinePoint: OutlinePoint;
  thoughts: Thought[];
  sectionName: string;
  onGenerate: (outlinePointId: string) => Promise<void>;
  generatedContent: string | null;
  isGenerating: boolean;
  sermonId: string;
  onOpenFragmentsModal: (outlinePointId: string) => void;
}

const OutlinePointCard = React.forwardRef<HTMLDivElement, OutlinePointCardProps>(({
  outlinePoint,
  thoughts,
  sectionName,
  onGenerate,
  generatedContent,
  isGenerating,
  sermonId,
  onOpenFragmentsModal,
}, ref) => {
  const { t } = useTranslation();
  
  // Map the API section name to the theme section name
  const themeSectionName = sectionName === 'main' ? 'mainPart' : sectionName as 'introduction' | 'mainPart' | 'conclusion';
  
  // Get the colors for this section
  const sectionColors = SERMON_SECTION_COLORS[themeSectionName];
  
  // Count key fragments across all thoughts for this outline point
  const keyFragmentsCount = thoughts.reduce((count, thought) => {
    return count + (thought.keyFragments?.length || 0);
  }, 0);
  
  return (
    <Card 
      ref={ref}
      className={`mb-4 p-4 border-${sectionColors.base.replace('#', '').substring(0, 3)} bg-white dark:bg-gray-800`}
    >
      <h3 className={`font-semibold text-lg mb-2 text-${sectionColors.text.split('-')[1]} flex justify-between items-center`}>
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
              <span className="absolute -top-1 -right-1 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border"
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
            title={isGenerating ? t("plan.generating") : generatedContent ? t("plan.regenerate") : t("plan.generate")}
          >
            {isGenerating ? (
              <LoadingSpinner size="small" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>
      </h3>
      
      <div className="mb-3">        
        <ul className="mt-2 ml-4 text-base">
          {thoughts.map((thought) => (
            <li key={thought.id} className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed text-base">
              • {thought.text}
              {thought.keyFragments && thought.keyFragments.length > 0 && (
                <div className="mt-1 ml-2">
                  {thought.keyFragments.map((fragment, index) => (
                    <span 
                      key={index} 
                      className="inline-block mr-2 mb-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs rounded-full"
                    >
                      "{fragment}"
                    </span>
                  ))}
                </div>
              )}
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

// Add a debounce utility to prevent too frequent calls
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function(...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default function PlanPage() {
  const { t } = useTranslation();
  const params = useParams();
  const sermonId = params?.id as string;
  const router = useRouter();
  
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Generated content by outline point ID
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({});
  // Currently generating outline point ID
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  
  // State to hold the combined generated content for each section
  const [combinedPlan, setCombinedPlan] = useState<{
    introduction: string;
    main: string;
    conclusion: string;
  }>({ introduction: '', main: '', conclusion: '' });
  
  // Refs for the outline point cards in each column
  const introPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  const mainPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  const conclusionPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  
  // Track saved outline points
  const [savedOutlinePoints, setSavedOutlinePoints] = useState<Record<string, boolean>>({});
  
  // Track which content has been modified since last save
  const [modifiedContent, setModifiedContent] = useState<Record<string, boolean>>({});
  
  // Add syncInProgress flag to prevent recursive sync calls
  const syncInProgressRef = useRef(false);
  
  // Add state to track which outline points are in edit mode
  const [editModePoints, setEditModePoints] = useState<Record<string, boolean>>({});
  
  const [modalOutlinePointId, setModalOutlinePointId] = useState<string | null>(null);
  
  const [showSectionMenu, setShowSectionMenu] = useState<boolean>(false);
  const sectionMenuRef = useRef<HTMLDivElement>(null);
  
  // Close section menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sectionMenuRef.current && !sectionMenuRef.current.contains(event.target as Node)) {
        setShowSectionMenu(false);
      }
    }
    
    if (showSectionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSectionMenu]);
  
  // Function to synchronize heights
  const syncHeights = () => {
    // Step 1: Reset all heights to auto
    Object.keys(introPointRefs.current).forEach(pointId => {
      const { left, right } = introPointRefs.current[pointId];
      if (left && right) {
        left.style.height = 'auto';
        right.style.height = 'auto';
      }
    });
    
    Object.keys(mainPointRefs.current).forEach(pointId => {
      const { left, right } = mainPointRefs.current[pointId];
      if (left && right) {
        left.style.height = 'auto';
        right.style.height = 'auto';
      }
    });
    
    Object.keys(conclusionPointRefs.current).forEach(pointId => {
      const { left, right } = conclusionPointRefs.current[pointId];
      if (left && right) {
        left.style.height = 'auto';
        right.style.height = 'auto';
      }
    });
    
    // Force reflow to ensure natural heights are calculated
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    document.body.offsetHeight;
    
    // Step 2: Measure and apply maximum heights
    Object.keys(introPointRefs.current).forEach(pointId => {
      const { left, right } = introPointRefs.current[pointId];
      if (left && right) {
        const maxHeight = Math.max(left.offsetHeight, right.offsetHeight);
        left.style.height = `${maxHeight}px`;
        right.style.height = `${maxHeight}px`;
      }
    });
    
    Object.keys(mainPointRefs.current).forEach(pointId => {
      const { left, right } = mainPointRefs.current[pointId];
      if (left && right) {
        const maxHeight = Math.max(left.offsetHeight, right.offsetHeight);
        left.style.height = `${maxHeight}px`;
        right.style.height = `${maxHeight}px`;
      }
    });
    
    Object.keys(conclusionPointRefs.current).forEach(pointId => {
      const { left, right } = conclusionPointRefs.current[pointId];
      if (left && right) {
        const maxHeight = Math.max(left.offsetHeight, right.offsetHeight);
        left.style.height = `${maxHeight}px`;
        right.style.height = `${maxHeight}px`;
      }
    });
  };
  
  // Create a debounced version of syncHeights with a 200ms delay
  const debouncedSyncHeights = useRef(debounce(syncHeights, 200)).current;
  
  // Update MutationObserver to be simpler and more focused
  useEffect(() => {
    // Direct sync on relevant changes
    const observer = new MutationObserver(() => {
      debouncedSyncHeights();
    });
    
    const containers = document.querySelectorAll('.rounded-lg.overflow-hidden');
    
    containers.forEach(container => {
      observer.observe(container, { 
        childList: true, 
        subtree: true, 
        characterData: true 
      });
    });
    
    // Initial sync
    setTimeout(syncHeights, 500);
    
    return () => {
      observer.disconnect();
    };
  }, [sermon?.outline, debouncedSyncHeights]);
  
  // Load the sermon
  useEffect(() => {
    async function loadSermon() {
      setIsLoading(true);
      try {
        const sermonData = await getSermonById(sermonId);
        
        if (!sermonData) {
          setError(t("errors.sermonNotFound"));
          return;
        }
        
        setSermon(sermonData);
        
        // Initialize the combined plan if a plan already exists
        if (sermonData.plan) {
          setCombinedPlan({
            introduction: sermonData.plan.introduction?.outline || "",
            main: sermonData.plan.main?.outline || "", 
            conclusion: sermonData.plan.conclusion?.outline || "",
          });
          
          // Initialize generatedContent from saved outlinePoints if they exist
          const savedContent: Record<string, string> = {};
          const savedPoints: Record<string, boolean> = {};
          
          // Extract all saved outline point content
          ['introduction', 'main', 'conclusion'].forEach(sectionKey => {
            const section = sermonData.plan?.[sectionKey as keyof Plan];
            const outlinePoints = section?.outlinePoints || {}; 
            
            Object.entries(outlinePoints).forEach(([pointId, content]) => {
              savedContent[pointId] = content;
              savedPoints[pointId] = true;
            });
          });
          
          // Set the saved content to the generatedContent state
          if (Object.keys(savedContent).length > 0) {
            setGeneratedContent(prev => ({...prev, ...savedContent}));
          }
          
          // Set all saved points at once
          if (Object.keys(savedPoints).length > 0) {
            setSavedOutlinePoints(savedPoints);
          }
        }
      } catch (err) {
        setError(t("errors.failedToLoadSermon"));
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    
    if (sermonId) {
      loadSermon();
    }
  }, [sermonId, t]);
  
  // Check if all thoughts are assigned to outline points
  const areAllThoughtsAssigned = (sermon: Sermon | null): boolean => {
    if (!sermon) return false;
    
    // Count thoughts that aren't assigned to an outline point
    const unassignedThoughts = sermon.thoughts.filter(
      (thought) => !thought.outlinePointId
    );
    
    return unassignedThoughts.length === 0;
  };
  
  // Get thoughts for a specific outline point
  const getThoughtsForOutlinePoint = (outlinePointId: string): Thought[] => {
    if (!sermon) return [];
    
    // 1. Найти точку плана и определить, к какой секции она относится
    let sectionName: string | null = null;
    
    if (sermon.outline?.introduction.some(op => op.id === outlinePointId)) {
      sectionName = "introduction";
    } else if (sermon.outline?.main.some(op => op.id === outlinePointId)) {
      sectionName = "main";
    } else if (sermon.outline?.conclusion.some(op => op.id === outlinePointId)) {
      sectionName = "conclusion";
    }
    
    if (!sectionName) {
      // Если секция не найдена, возвращаем мысли в порядке по умолчанию
      return sermon.thoughts.filter(thought => thought.outlinePointId === outlinePointId);
    }
    
    // 2. Получаем упорядоченный массив ID мыслей из структуры для данной секции
    const structureIds = sermon.structure?.[sectionName as keyof Structure];
    const structureIdsArray = Array.isArray(structureIds) ? structureIds : 
                           (typeof structureIds === 'string' ? JSON.parse(structureIds) : []);
    
    // 3. Отфильтровываем все мысли, связанные с данной точкой плана
    const thoughtsForPoint = sermon.thoughts.filter(thought => thought.outlinePointId === outlinePointId);
    
    // 4. Если массив структуры пуст, возвращаем мысли без сортировки
    if (!structureIdsArray.length) {
      return thoughtsForPoint;
    }
    
    // 5. Сортируем мысли в соответствии с порядком в структуре
    return thoughtsForPoint.sort((a, b) => {
      const indexA = structureIdsArray.indexOf(a.id);
      const indexB = structureIdsArray.indexOf(b.id);
      
      // Если мысль не найдена в структуре, помещаем её в конец
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      
      // Сортировка по порядку в структуре
      return indexA - indexB;
    });
  };

  // Find thoughts for an outline point
  const findThoughtsForOutlinePoint = (outlinePointId: string): Thought[] => {
    // Используем существующую функцию с учетом порядка из структуры
    return getThoughtsForOutlinePoint(outlinePointId);
  };

  // Generate content for an outline point
  const generateOutlinePointContent = async (outlinePointId: string) => {
    if (!sermon) return;
    
    setGeneratingId(outlinePointId);
    
    try {
      // Find the outline point in the sermon structure
      let outlinePoint: OutlinePoint | undefined;
      let section: string | undefined;
      
      if (sermon.outline?.introduction.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.introduction.find((op) => op.id === outlinePointId);
        section = "introduction";
      } else if (sermon.outline?.main.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.main.find((op) => op.id === outlinePointId);
        section = "main";
      } else if (sermon.outline?.conclusion.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.conclusion.find((op) => op.id === outlinePointId);
        section = "conclusion";
      }
      
      if (!outlinePoint || !section) {
        toast.error(t("errors.outlinePointNotFound"));
        return;
      }
      
      // Call the API to generate content
      const response = await fetch(`/api/sermons/${sermon.id}/plan?outlinePointId=${outlinePointId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to generate content: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Update the generated content
      setGeneratedContent((prev) => ({
        ...prev,
        [outlinePointId]: data.content,
      }));
      
      // Mark content as modified since it was just generated
      setModifiedContent(prev => ({
        ...prev,
        [outlinePointId]: true
      }));
      
      // Update the combined plan
      updateCombinedPlan(outlinePointId, outlinePoint.text, data.content, section as 'introduction' | 'main' | 'conclusion');
      
      toast.success(t("plan.contentGenerated"));
    } catch (err) {
      console.error(err);
      toast.error(t("errors.failedToGenerateContent"));
    } finally {
      setGeneratingId(null);
    }
  };
  
  // Update the combined plan when a new outline point content is generated
  const updateCombinedPlan = (
    outlinePointId: string,
    outlinePointText: string,
    content: string,
    section: 'introduction' | 'main' | 'conclusion'
  ) => {
    setCombinedPlan((prev) => {
      // Create a heading with the outline point text
      const heading = `## ${outlinePointText}`;
      
      // Current content of the section
      const currentSectionContent = prev[section];
      
      // Check if the heading already exists in the content
      const headingIndex = currentSectionContent.indexOf(heading);
      
      if (headingIndex !== -1) {
        // Find the end of the current content for this heading
        const nextHeadingIndex = currentSectionContent.indexOf("## ", headingIndex + heading.length);
        
        // If there's a next heading, replace the content between the headings
        if (nextHeadingIndex !== -1) {
          const beforeHeading = currentSectionContent.substring(0, headingIndex + heading.length);
          const afterNextHeading = currentSectionContent.substring(nextHeadingIndex);
          
          return {
            ...prev,
            [section]: `${beforeHeading}\n\n${content}\n\n${afterNextHeading}`,
          };
        } else {
          // If there's no next heading, replace everything after the current heading
          return {
            ...prev,
            [section]: `${currentSectionContent.substring(0, headingIndex + heading.length)}\n\n${content}`,
          };
        }
      } else {
        // If the heading doesn't exist yet, append it to the section
        return {
          ...prev,
          [section]: currentSectionContent
            ? `${currentSectionContent}\n\n${heading}\n\n${content}`
            : `${heading}\n\n${content}`,
        };
      }
    });
  };
  
  // Save the plan to the server
  const savePlan = async () => {
    if (!sermon) return;
    
    try {
      const planToSave: Plan = {
        introduction: { outline: combinedPlan.introduction },
        main: { outline: combinedPlan.main },
        conclusion: { outline: combinedPlan.conclusion },
      };
      
      const response = await fetch(`/api/sermons/${sermon.id}/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(planToSave),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save plan: ${response.status}`);
      }
      
      toast.success(t("plan.planSaved"));
    } catch (err) {
      console.error(err);
      toast.error(t("errors.failedToSavePlan"));
    }
  };
  
  // Save individual outline point
  const saveOutlinePoint = async (outlinePointId: string, content: string, section: keyof Plan) => {
    if (!sermon) return;
    
    try {
      // First fetch the latest sermon plan from server to avoid overwriting recent changes
      const latestSermonResponse = await fetch(`/api/sermons/${sermon.id}`);
      if (!latestSermonResponse.ok) {
        throw new Error(`Failed to fetch latest sermon data: ${latestSermonResponse.status}`);
      }
      
      const latestSermon = await latestSermonResponse.json();
      
      // Create plan object if it doesn't exist
      const currentPlan = latestSermon.plan || {
        introduction: { outline: "" },
        main: { outline: "" },
        conclusion: { outline: "" }
      };
      
      // Preserve existing outline points and add/update the new one
      const existingOutlinePoints = currentPlan[section]?.outlinePoints || {};
      
      // Update the outline point in the plan
      const updatedPlan: Plan = {
        ...currentPlan,
        [section]: {
          ...currentPlan[section],
          outlinePoints: {
            ...existingOutlinePoints,
            [outlinePointId]: content
          }
        }
      };
      
      // Send the updated plan to the server
      const response = await fetch(`/api/sermons/${sermon.id}/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedPlan),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save outline point: ${response.status}`);
      }
      
      // Mark this point as saved
      setSavedOutlinePoints(prev => ({...prev, [outlinePointId]: true}));
      
      // Mark content as unmodified since it's now saved
      setModifiedContent(prev => ({...prev, [outlinePointId]: false}));
      
      toast.success(t("plan.pointSaved"));
      
      // Check if all points in this section are saved
      const allPointsInSection = sermon.outline?.[section] || [];
      const allSaved = allPointsInSection.every(point => 
        savedOutlinePoints[point.id] || point.id === outlinePointId
      );
      
      // If all points are saved, update the combined section text
      if (allSaved && allPointsInSection.length > 0) {
        // Collect all content for this section
        const sectionTexts = allPointsInSection.map(point => {
          const pointContent = point.id === outlinePointId ? 
            content : 
            updatedPlan[section]?.outlinePoints?.[point.id] || "";
          
          return `## ${point.text}\n\n${pointContent}`;
        });
        
        const combinedText = sectionTexts.join("\n\n");
        
        // Update the section outline with the combined text
        const finalPlan: Plan = {
          ...updatedPlan,
          [section]: {
            ...updatedPlan[section],
            outline: combinedText
          }
        };
        
        // Save the final combined plan
        const finalResponse = await fetch(`/api/sermons/${sermon.id}/plan`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(finalPlan),
        });
        
        if (finalResponse.ok) {
          // Update the local sermon data with the latest plan
          setSermon(prevSermon => prevSermon ? {...prevSermon, plan: finalPlan} : null);
          
          // Update the local combined plan state
          setCombinedPlan(prev => ({
            ...prev,
            [section]: combinedText
          }));
          
          toast.success(t("plan.sectionSaved", { section: t(`sections.${section}`) }));
        } else {
          throw new Error(`Failed to save section: ${finalResponse.status}`);
        }
      } else {
        // Update local sermon data with the latest plan even if we don't save the combined text
        setSermon(prevSermon => prevSermon ? {...prevSermon, plan: updatedPlan} : null);
      }
    } catch (err) {
      console.error(err);
      toast.error(t("errors.failedToSavePoint"));
    }
  };
  
  // Toggle edit mode for an outline point
  const toggleEditMode = (outlinePointId: string) => {
    setEditModePoints(prev => ({
      ...prev,
      [outlinePointId]: !prev[outlinePointId]
    }));
    
    // When switching to view mode, we need to sync heights after a short delay
    // to ensure proper rendering of the formatted content
    setTimeout(debouncedSyncHeights, 50);
  };
  
  // Handle thought update from key fragments modal
  const handleThoughtUpdate = (updatedThought: Thought) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        thoughts: prevSermon.thoughts.map(t => 
          t.id === updatedThought.id ? updatedThought : t
        )
      };
    });
  };
  
  // Find outline point by id
  const findOutlinePointById = (outlinePointId: string): OutlinePoint | undefined => {
    if (!sermon || !sermon.outline) return undefined;
    
    let outlinePoint;
    
    if (sermon.outline.introduction.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.introduction.find(op => op.id === outlinePointId);
    } else if (sermon.outline.main.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.main.find(op => op.id === outlinePointId);
    } else if (sermon.outline.conclusion.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.conclusion.find(op => op.id === outlinePointId);
    }
    
    return outlinePoint;
  };
  
  // Generate content for export as text
  const getExportContent = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }): Promise<string> => {
    if (!sermon) return '';
    
    const titleSection = `# ${sermon.title}\n\n`;
    const verseSection = sermon.verse ? `> ${sermon.verse}\n\n` : '';
    
    // Format the outline points and their content
    const introSection = `## ${t("sections.introduction")}\n\n${combinedPlan.introduction || t("plan.noContent")}\n\n`;
    const mainSection = `## ${t("sections.main")}\n\n${combinedPlan.main || t("plan.noContent")}\n\n`;
    const conclusionSection = `## ${t("sections.conclusion")}\n\n${combinedPlan.conclusion || t("plan.noContent")}\n\n`;
    
    // Combine all sections
    const markdown = `${titleSection}${verseSection}${introSection}${mainSection}${conclusionSection}`;
    
    // For plain text, we need to strip markdown formatting
    if (format === 'plain') {
      // A very simple markdown to plain text conversion - for a proper conversion, use a library
      return markdown
        .replace(/#{1,6}\s(.*)/g, '$1\n') // headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // bold
        .replace(/\*(.*?)\*/g, '$1') // italic
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)') // links
        .replace(/\n>/g, '\n') // blockquotes
        .replace(/>/g, '') // blockquotes at start
        .replace(/\n\n+/g, '\n\n'); // multiple line breaks
    }
    
    return markdown;
  };

  // Generate content for PDF export
  const getPdfContent = async (): Promise<React.ReactNode> => {
    if (!sermon) return null;
    
    return (
      <div className="p-6 bg-white text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
        <h1 className="text-3xl font-bold mb-4">{sermon.title}</h1>
        
        {sermon.verse && (
          <div className="mb-8 p-4 bg-gray-50 rounded-md border-l-4 border-blue-500">
            <p className="text-gray-700 italic text-lg whitespace-pre-line">
              {sermon.verse}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {t("common.scripture")}
            </p>
          </div>
        )}
        
        <div className="mb-8 pb-6 border-b-2 border-blue-300">
          <h2 className="text-2xl font-bold text-blue-700 mb-4">
            {t("sections.introduction")}
          </h2>
          <div className="pl-2 border-l-4 border-blue-400">
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.introduction || t("plan.noContent")}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        
        <div className="mb-8 pb-6 border-b-2 border-purple-300">
          <h2 className="text-2xl font-bold text-purple-700 mb-4">
            {t("sections.main")}
          </h2>
          <div className="pl-2 border-l-4 border-purple-400">
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.main || t("plan.noContent")}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-green-700 mb-4">
            {t("sections.conclusion")}
          </h2>
          <div className="pl-2 border-l-4 border-green-400">
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.conclusion || t("plan.noContent")}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="large" />
      </div>
    );
  }
  
  if (error || !sermon) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">{error}</h1>
        <Button onClick={() => router.push(`/sermons/${params.id}`)}>
          {t("actions.backToSermon")}
        </Button>
      </div>
    );
  }
  
  // Check if all thoughts are assigned to outline points
  if (!areAllThoughtsAssigned(sermon)) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-bold mb-4">{t("plan.thoughtsNotAssigned")}</h1>
        <p className="mb-6">{t("plan.assignThoughtsFirst")}</p>
        <Button
          onClick={() => router.push(`/sermons/${params.id}/outline`)}
          variant="primary"
        >
          {t("actions.goToOutline")}
        </Button>
      </div>
    );
  }
  
  return (
    <div 
      className="min-h-screen bg-white dark:bg-gray-900 p-4"
      data-testid="sermon-plan-page-container"
    >
      <style jsx global>{sectionButtonStyles}</style>
      <style jsx global>{`
        /* Markdown content styling */
        .markdown-content {
          line-height: 1.5;
        }
        .markdown-content p {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .markdown-content h1, 
        .markdown-content h2, 
        .markdown-content h3, 
        .markdown-content h4, 
        .markdown-content h5, 
        .markdown-content h6 {
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        /* Indentation for hierarchical structure */
        .markdown-content h2 {
          margin-left: 0;
        }
        .markdown-content h3 {
          margin-left: 1.5rem;
        }
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin-left: 3rem;
        }
        /* Indent paragraphs and lists to align with their headings */
        .markdown-content h2 + p, .markdown-content h2 + ul, .markdown-content h2 + ol {
          margin-left: 1.5rem;
        }
        .markdown-content h3 + p, .markdown-content h3 + ul, .markdown-content h3 + ol {
          margin-left: 3rem;
        }
        .markdown-content h4 + p, .markdown-content h4 + ul, .markdown-content h4 + ol,
        .markdown-content h5 + p, .markdown-content h5 + ul, .markdown-content h5 + ol,
        .markdown-content h6 + p, .markdown-content h6 + ul, .markdown-content h6 + ol {
          margin-left: 4.5rem;
        }
        /* Continuing indentation for paragraphs without headings */
        .markdown-content p + p, .markdown-content ul + p, .markdown-content ol + p {
          margin-left: inherit;
        }
        .markdown-content ul, 
        .markdown-content ol {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
          padding-left: 1.5em;
        }
        .markdown-content li {
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .markdown-content li > p {
          margin-top: 0;
          margin-bottom: 0;
        }
        /* Remove borders from all elements */
        .markdown-content * {
          border: none !important;
        }
        /* Fix for first paragraph layout issue */
        .markdown-content > p:first-child {
          margin-top: 0;
          display: inline-block;
        }
        /* Ensure first element doesn't create unwanted space */
        .markdown-content > *:first-child {
          margin-top: 0;
        }
        
        /* Visual markers for different heading levels */
        .markdown-content h2::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 20px;
          background-color: #2563eb; /* Introduction base color - Blue-600 */
          margin-right: 10px;
          border-radius: 2px;
          vertical-align: text-top;
        }
        
        /* Use section context to style bullets */
        /* Introduction bullets (h3) */
        .prose-introduction h3::before,
        .introduction-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: #3b82f6; /* Blue-500 */
          font-weight: bold;
        }
        
        /* Main section bullets (h3) */
        .prose-main h3::before,
        .main-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: #a855f7; /* Purple-500 */
          font-weight: bold;
        }
        
        /* Conclusion bullets (h3) */
        .prose-conclusion h3::before,
        .conclusion-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: #22c55e; /* Green-500 */
          font-weight: bold;
        }
        
        /* Default h3 bullets - only apply when no section class is present */
        .markdown-content h3:not(.prose-introduction h3):not(.prose-main h3):not(.prose-conclusion h3):not(.introduction-section h3):not(.main-section h3):not(.conclusion-section h3)::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: #7e22ce; /* Main Part base color - Purple-700 */
          font-weight: bold;
        }
        
        /* Default h4 circles */
        .markdown-content h4::before {
          content: "○";
          display: inline-block;
          margin-right: 8px;
          color: #16a34a; /* Conclusion base color - Green-600 */
          font-weight: bold;
        }
        
        /* Section-specific styles for introduction section */
        .prose-introduction h2::before {
          background-color: #2563eb; /* Blue-600 */
        }
        .prose-introduction h4::before {
          color: #1d4ed8; /* Blue-700 */
        }
        
        /* Section-specific styles for main section */
        .prose-main h2::before {
          background-color: #7e22ce; /* Purple-700 */
        }
        .prose-main h4::before {
          color: #6b21a8; /* Purple-800 */
        }
        
        /* Section-specific styles for conclusion section */
        .prose-conclusion h2::before {
          background-color: #16a34a; /* Green-600 */
        }
        .prose-conclusion h4::before {
          color: #15803d; /* Green-700 */
        }

        /* Dark mode colors */
        @media (prefers-color-scheme: dark) {
          .markdown-content h2::before {
            background-color: #3b82f6; /* Blue-500 */
          }
          .markdown-content h3:not(.prose-introduction h3):not(.prose-main h3):not(.prose-conclusion h3):not(.introduction-section h3):not(.main-section h3):not(.conclusion-section h3)::before {
            color: #a855f7; /* Purple-500 */
          }
          .markdown-content h4::before {
            color: #22c55e; /* Green-500 */
          }
        }
      `}</style>
      <div className="w-full">
        {/* Page Header */}
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
              {/* <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t("plan.pageTitle")}
              </h1> */}
            </div>
          </div>
          
          {/* Sermon Title & Verse */}
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
                    {t("common.scripture")}
                  </p>
                </div>
              )}
              
              {/* View Plan Buttons */}
              <div className="flex flex-wrap gap-3 mt-6">
                <ViewPlanMenu
                  sermonTitle={sermon.title}
                  sermonVerse={sermon.verse}
                  combinedPlan={combinedPlan}
                  sectionMenuRef={sectionMenuRef}
                  showSectionMenu={showSectionMenu}
                  setShowSectionMenu={setShowSectionMenu}
                />
                
                {/* Add Export Buttons */}
                <ExportButtons
                  sermonId={sermonId}
                  getExportContent={getExportContent}
                  getPdfContent={getPdfContent}
                  title={sermon.title || "Sermon Plan"}
                  className="ml-auto"
                  disabledFormats={['pdf']} // Add this prop to disable PDF
                />
              </div>
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Intro Left & Right */}
          <div 
            data-testid="plan-introduction-left-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-blue-500 dark:bg-blue-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
              {t("sections.introduction")}
            </h2>
            <div className="p-3">
              {sermon.outline?.introduction.map((outlinePoint) => (
                <OutlinePointCard
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!introPointRefs.current[outlinePoint.id]) {
                      introPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    introPointRefs.current[outlinePoint.id].left = el;
                  }}
                  outlinePoint={outlinePoint}
                  thoughts={getThoughtsForOutlinePoint(outlinePoint.id)}
                  sectionName="introduction"
                  onGenerate={generateOutlinePointContent}
                  generatedContent={generatedContent[outlinePoint.id] || null}
                  isGenerating={generatingId === outlinePoint.id}
                  sermonId={sermonId}
                  onOpenFragmentsModal={setModalOutlinePointId}
                />
              ))}
              {sermon.outline?.introduction.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
          
          <div 
            data-testid="plan-introduction-right-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-blue-500 dark:bg-blue-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
              {t("sections.introduction")}
            </h2>
            <div className="p-3">
              {sermon.outline?.introduction.map((outlinePoint) => (
                <div 
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!introPointRefs.current[outlinePoint.id]) {
                      introPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    introPointRefs.current[outlinePoint.id].right = el;
                  }}
                  className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                >
                  <h3 className={`font-semibold text-lg mb-2 text-blue-800 dark:text-blue-400 flex justify-between items-center`}>
                    {outlinePoint.text}
                    <div className="flex space-x-2">
                      <Button
                        className="text-sm px-2 py-1 h-8"
                        onClick={() => saveOutlinePoint(
                          outlinePoint.id,
                          generatedContent[outlinePoint.id] || "",
                          "introduction"
                        )}
                        variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                        sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.introduction : undefined}
                        disabled={
                          !generatedContent[outlinePoint.id] || 
                          generatedContent[outlinePoint.id].trim() === "" || 
                          (savedOutlinePoints[outlinePoint.id] && !modifiedContent[outlinePoint.id])
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
                      onClick={() => toggleEditMode(outlinePoint.id)}
                      variant="default"
                      title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
                    >
                      {editModePoints[outlinePoint.id] ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    {editModePoints[outlinePoint.id] ? (
                      <TextareaAutosize
                        className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
                        minRows={4}
                        placeholder={t("plan.noContent")}
                        value={generatedContent[outlinePoint.id] || ""}
                        onChange={(e) => {
                          const newContent = e.target.value;
                          // Mark content as modified if it's different from the current saved content
                          const currentSavedContent = sermon.plan?.introduction?.outlinePoints?.[outlinePoint.id] || "";
                          const isModified = newContent !== currentSavedContent;
                          
                          setGeneratedContent((prev) => ({
                            ...prev,
                            [outlinePoint.id]: newContent,
                          }));
                          
                          // Mark as modified if content changed
                          setModifiedContent(prev => ({
                            ...prev,
                            [outlinePoint.id]: isModified
                          }));
                          
                          updateCombinedPlan(
                            outlinePoint.id,
                            outlinePoint.text,
                            newContent,
                            "introduction"
                          );
                          // Height will be synced by the MutationObserver
                        }}
                        onHeightChange={() => {
                          // Use debounced sync when the textarea's height changes
                          debouncedSyncHeights();
                        }}
                      />
                    ) : (
                      <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                        <div className="absolute top-2 right-2 z-10">
                          <Button
                            className="text-sm px-2 py-1 h-8"
                            onClick={() => toggleEditMode(outlinePoint.id)}
                            variant="default"
                            title={t("plan.editMode")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="p-3 pr-12">
                          <MarkdownRenderer 
                            markdown={generatedContent[outlinePoint.id] || t("plan.noContent")} 
                            section="introduction"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sermon.outline?.introduction.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
          
          {/* Main Left & Right */}
          <div 
            data-testid="plan-main-left-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-purple-500 dark:bg-purple-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
              {t("sections.main")}
            </h2>
            <div className="p-3">
              {sermon.outline?.main.map((outlinePoint) => (
                <OutlinePointCard
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!mainPointRefs.current[outlinePoint.id]) {
                      mainPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    mainPointRefs.current[outlinePoint.id].left = el;
                  }}
                  outlinePoint={outlinePoint}
                  thoughts={getThoughtsForOutlinePoint(outlinePoint.id)}
                  sectionName="main"
                  onGenerate={generateOutlinePointContent}
                  generatedContent={generatedContent[outlinePoint.id] || null}
                  isGenerating={generatingId === outlinePoint.id}
                  sermonId={sermonId}
                  onOpenFragmentsModal={setModalOutlinePointId}
                />
              ))}
              {sermon.outline?.main.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
          
          <div 
            data-testid="plan-main-right-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-purple-500 dark:bg-purple-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
              {t("sections.main")}
            </h2>
            <div className="p-3">
              {sermon.outline?.main.map((outlinePoint) => (
                <div 
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!mainPointRefs.current[outlinePoint.id]) {
                      mainPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    mainPointRefs.current[outlinePoint.id].right = el;
                  }}
                  className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                >
                  <h3 className={`font-semibold text-lg mb-2 text-purple-800 dark:text-purple-400 flex justify-between items-center`}>
                    {outlinePoint.text}
                    <div className="flex space-x-2">
                      <Button
                        className="text-sm px-2 py-1 h-8"
                        onClick={() => saveOutlinePoint(
                          outlinePoint.id,
                          generatedContent[outlinePoint.id] || "",
                          "main"
                        )}
                        variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                        sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.mainPart : undefined}
                        disabled={
                          !generatedContent[outlinePoint.id] || 
                          generatedContent[outlinePoint.id].trim() === "" || 
                          (savedOutlinePoints[outlinePoint.id] && !modifiedContent[outlinePoint.id])
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
                      onClick={() => toggleEditMode(outlinePoint.id)}
                      variant="default"
                      title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
                    >
                      {editModePoints[outlinePoint.id] ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    {editModePoints[outlinePoint.id] ? (
                      <TextareaAutosize
                        className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
                        minRows={4}
                        placeholder={t("plan.noContent")}
                        value={generatedContent[outlinePoint.id] || ""}
                        onChange={(e) => {
                          const newContent = e.target.value;
                          // Mark content as modified if it's different from the current saved content
                          const currentSavedContent = sermon.plan?.main?.outlinePoints?.[outlinePoint.id] || "";
                          const isModified = newContent !== currentSavedContent;
                          
                          setGeneratedContent((prev) => ({
                            ...prev,
                            [outlinePoint.id]: newContent,
                          }));
                          
                          // Mark as modified if content changed
                          setModifiedContent(prev => ({
                            ...prev,
                            [outlinePoint.id]: isModified
                          }));
                          
                          updateCombinedPlan(
                            outlinePoint.id,
                            outlinePoint.text,
                            newContent,
                            "main"
                          );
                          // Height will be synced by the MutationObserver
                        }}
                        onHeightChange={() => {
                          // Use debounced sync when the textarea's height changes
                          debouncedSyncHeights();
                        }}
                      />
                    ) : (
                      <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                        <div className="absolute top-2 right-2 z-10">
                          <Button
                            className="text-sm px-2 py-1 h-8"
                            onClick={() => toggleEditMode(outlinePoint.id)}
                            variant="default"
                            title={t("plan.editMode")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="p-3 pr-12">
                          <MarkdownRenderer 
                            markdown={generatedContent[outlinePoint.id] || t("plan.noContent")} 
                            section="main"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sermon.outline?.main.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
          
          {/* Conclusion Left & Right */}
          <div 
            data-testid="plan-conclusion-left-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-green-500 dark:bg-green-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
              {t("sections.conclusion")}
            </h2>
            <div className="p-3">
              {sermon.outline?.conclusion.map((outlinePoint) => (
                <OutlinePointCard
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!conclusionPointRefs.current[outlinePoint.id]) {
                      conclusionPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    conclusionPointRefs.current[outlinePoint.id].left = el;
                  }}
                  outlinePoint={outlinePoint}
                  thoughts={getThoughtsForOutlinePoint(outlinePoint.id)}
                  sectionName="conclusion"
                  onGenerate={generateOutlinePointContent}
                  generatedContent={generatedContent[outlinePoint.id] || null}
                  isGenerating={generatingId === outlinePoint.id}
                  sermonId={sermonId}
                  onOpenFragmentsModal={setModalOutlinePointId}
                />
              ))}
              {sermon.outline?.conclusion.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
          
          <div 
            data-testid="plan-conclusion-right-section"
            className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`}
          >
            <h2 className={`text-xl font-semibold p-3 bg-green-500 dark:bg-green-700 text-white dark:text-white border-b ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
              {t("sections.conclusion")}
            </h2>
            <div className="p-3">
              {sermon.outline?.conclusion.map((outlinePoint) => (
                <div 
                  key={outlinePoint.id}
                  ref={(el) => {
                    if (!conclusionPointRefs.current[outlinePoint.id]) {
                      conclusionPointRefs.current[outlinePoint.id] = { left: null, right: null };
                    }
                    conclusionPointRefs.current[outlinePoint.id].right = el;
                  }}
                  className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                >
                  <h3 className={`font-semibold text-lg mb-2 text-green-800 dark:text-green-400 flex justify-between items-center`}>
                    {outlinePoint.text}
                    <div className="flex space-x-2">
                      <Button
                        className="text-sm px-2 py-1 h-8"
                        onClick={() => saveOutlinePoint(
                          outlinePoint.id,
                          generatedContent[outlinePoint.id] || "",
                          "conclusion"
                        )}
                        variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                        sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.conclusion : undefined}
                        disabled={
                          !generatedContent[outlinePoint.id] || 
                          generatedContent[outlinePoint.id].trim() === "" || 
                          (savedOutlinePoints[outlinePoint.id] && !modifiedContent[outlinePoint.id])
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
                      onClick={() => toggleEditMode(outlinePoint.id)}
                      variant="default"
                      title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
                    >
                      {editModePoints[outlinePoint.id] ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    {editModePoints[outlinePoint.id] ? (
                      <TextareaAutosize
                        className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
                        minRows={4}
                        placeholder={t("plan.noContent")}
                        value={generatedContent[outlinePoint.id] || ""}
                        onChange={(e) => {
                          const newContent = e.target.value;
                          // Mark content as modified if it's different from the current saved content
                          const currentSavedContent = sermon.plan?.conclusion?.outlinePoints?.[outlinePoint.id] || "";
                          const isModified = newContent !== currentSavedContent;
                          
                          setGeneratedContent((prev) => ({
                            ...prev,
                            [outlinePoint.id]: newContent,
                          }));
                          
                          // Mark as modified if content changed
                          setModifiedContent(prev => ({
                            ...prev,
                            [outlinePoint.id]: isModified
                          }));
                          
                          updateCombinedPlan(
                            outlinePoint.id,
                            outlinePoint.text,
                            newContent,
                            "conclusion"
                          );
                          // Height will be synced by the MutationObserver
                        }}
                        onHeightChange={() => {
                          // Use debounced sync when the textarea's height changes
                          debouncedSyncHeights();
                        }}
                      />
                    ) : (
                      <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                        <div className="absolute top-2 right-2 z-10">
                          <Button
                            className="text-sm px-2 py-1 h-8"
                            onClick={() => toggleEditMode(outlinePoint.id)}
                            variant="default"
                            title={t("plan.editMode")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="p-3 pr-12">
                          <MarkdownRenderer 
                            markdown={generatedContent[outlinePoint.id] || t("plan.noContent")} 
                            section="conclusion"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sermon.outline?.conclusion.length === 0 && (
                <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
              )}
            </div>
          </div>
        </div>

        {/* Key Fragments Modal */}
        {modalOutlinePointId && (() => {
          const outlinePoint = findOutlinePointById(modalOutlinePointId);
          if (!outlinePoint) return null;
          return (
            <KeyFragmentsModal
              data-testid="key-fragments-modal-instance"
              isOpen={!!modalOutlinePointId}
              onClose={() => setModalOutlinePointId(null)}
              outlinePoint={outlinePoint}
              thoughts={getThoughtsForOutlinePoint(modalOutlinePointId)}
              sermonId={sermonId}
              onThoughtUpdate={handleThoughtUpdate}
            />
          );
        })()}
      </div>
    </div>
  );
} 