"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { getSermonPlan, generateSermonPlan } from "@/services/plan.service";
import useSermon from "@/hooks/useSermon";
import Link from "next/link";
import DashboardNav from "@/components/navigation/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { Plan } from "@/models/models";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@locales/i18n";

export default function SermonOutlinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { sermon, loading: sermonLoading, setSermon } = useSermon(id);
  const [plan, setPlan] = useState<Plan | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSections, setGeneratingSections] = useState<Record<string, boolean>>({
    introduction: false,
    main: false,
    conclusion: false,
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({
    introduction: false,
    main: false,
    conclusion: false,
    full: false,
  });
  
  // Modal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [currentCopyContent, setCurrentCopyContent] = useState('');
  const [currentCopySection, setCurrentCopySection] = useState('');
  const [isFormattedText, setIsFormattedText] = useState(false);
  const formattedTextRef = useRef<HTMLDivElement>(null);
  
  // Use useMemo to recalculate isAnyGenerating when its dependencies change
  const isAnyGenerating = useMemo(() => {
    return isGenerating || Object.values(generatingSections).some(value => value);
  }, [isGenerating, generatingSections]);

  useEffect(() => {
    const fetchPlan = async () => {
      if (!id) return;
      
      setLoading(true);
      setError(null);
      
      try {
        console.log("sermon", sermon);
        if (sermon === null) {
          // Sermon is still loading, wait for it
          return;
        }
        
        if (sermon && sermon.plan) {
          console.log("Using existing plan from sermon data");
          setPlan(sermon.plan);
        } else {
          console.log("No plan in sermon data, checking API");
          // Don't attempt to generate a new plan automatically
        }
      } catch (err) {
        console.error("Error fetching sermon plan:", err);
        setError(t('errors.fetchPlanError'));
      } finally {
        setLoading(false);
      }
    };
    
    fetchPlan();
  }, [id, sermon, t, setSermon]);

  const handleGeneratePlan = async () => {
    if (!id) return;
    
    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      const generatedPlan = await generateSermonPlan(id);
      if (generatedPlan) {
        setPlan(generatedPlan);
        if (sermon) {
          setSermon({
            ...sermon,
            plan: generatedPlan
          });
        }
        setSuccessMessage(t('plan.generateSuccess'));
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(t('plan.error'));
      }
    } catch (err) {
      console.error("Error generating sermon plan:", err);
      setError(t('plan.error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateSection = async (section: 'introduction' | 'main' | 'conclusion') => {
    if (!id) return;
    
    setGeneratingSections(prev => ({ ...prev, [section]: true }));
    setError(null);
    setSuccessMessage(null);
    
    try {
      const sectionPlan = await generateSermonPlan(id, section);
      
      if (!sectionPlan) {
        throw new Error(`Failed to regenerate ${section}`);
      }
      
      // Update only the specified section in the plan
      if (plan) {
        const updatedPlan: Plan = {
          introduction: { ...plan.introduction },
          main: { ...plan.main },
          conclusion: { ...plan.conclusion }
        };
        
        // Make sure the updated section is available in sectionPlan
        if (sectionPlan[section]) {
          updatedPlan[section] = sectionPlan[section];
        }
        
        setPlan(updatedPlan);
        
        if (sermon) {
          setSermon({
            ...sermon,
            plan: updatedPlan
          });
        }
      }
      
      setSuccessMessage(`${section.charAt(0).toUpperCase() + section.slice(1)} ${t('plan.regenerateSuccess')}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      
    } catch (err) {
      console.error(`Error regenerating ${section}:`, err);
      setError(`${t('plan.regenerateError')} ${section}`);
    } finally {
      setGeneratingSections(prev => ({ ...prev, [section]: false }));
    }
  };

  const handleOpenCopyModal = (text: string, section: string) => {
    setCurrentCopyContent(text);
    setCurrentCopySection(section);
    setShowCopyModal(true);
    // Reset to default view when opening modal
    setIsFormattedText(false);
  };

  const handleCopyFromModal = () => {
    // If in formatted mode, get HTML from the formatted div
    if (isFormattedText && formattedTextRef.current) {
      // Create a range and selection
      const range = document.createRange();
      const selection = window.getSelection();
      
      range.selectNodeContents(formattedTextRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
      
      // Copy the selected content
      document.execCommand('copy');
      selection?.removeAllRanges();
      
      // Update copy status
      setCopyStatus({ ...copyStatus, [currentCopySection]: true });
      setTimeout(() => {
        setCopyStatus({ ...copyStatus, [currentCopySection]: false });
      }, 2000);
      
      setShowCopyModal(false);
    } else {
      // Otherwise copy the raw markdown
      navigator.clipboard.writeText(currentCopyContent).then(
        () => {
          setCopyStatus({ ...copyStatus, [currentCopySection]: true });
          setTimeout(() => {
            setCopyStatus({ ...copyStatus, [currentCopySection]: false });
          }, 2000);
          setShowCopyModal(false);
        },
        (err) => {
          console.error("Could not copy text: ", err);
          setError(t('errors.copyError'));
        }
      );
    }
  };

  const handleCopyToClipboard = (text: string, section: string) => {
    handleOpenCopyModal(text, section);
  };

  const handleCopyFullPlan = () => {
    if (!plan) return;
    
    // Prepare each section with proper headings
    let introContent = plan.introduction.outline || '';
    let mainContent = plan.main.outline || '';
    let conclusionContent = plan.conclusion.outline || '';
    
    // Clean any existing section headers
    const introTitleRegex = new RegExp(`^\\s*#\\s+introduction\\s*$`, 'im');
    const mainTitleRegex = new RegExp(`^\\s*#\\s+main\\s*$`, 'im');
    const conclusionTitleRegex = new RegExp(`^\\s*#\\s+conclusion\\s*$`, 'im');
    
    introContent = introContent.replace(introTitleRegex, '').trim();
    mainContent = mainContent.replace(mainTitleRegex, '').trim();
    conclusionContent = conclusionContent.replace(conclusionTitleRegex, '').trim();
    
    // Add proper level 1 headings for each section
    if (introContent) {
      introContent = `# ${t('outline.introduction')}\n\n${introContent}`;
    }
    
    if (mainContent) {
      mainContent = `# ${t('outline.mainPoints')}\n\n${mainContent}`;
    }
    
    if (conclusionContent) {
      conclusionContent = `# ${t('outline.conclusion')}\n\n${conclusionContent}`;
    }
    
    // Join all sections with proper spacing
    const fullText = [
      introContent,
      mainContent,
      conclusionContent
    ].filter(Boolean).join('\n\n');
    
    handleOpenCopyModal(fullText, 'full');
  };

  const renderSectionContent = (sectionKey: 'introduction' | 'main' | 'conclusion', title: string) => {
    let content = plan?.[sectionKey]?.outline || '';
    
    // Remove section title from the beginning if it exists
    // Check for "# INTRODUCTION", "# MAIN", or "# CONCLUSION" at the start of content
    const sectionTitleRegex = new RegExp(`^\\s*#\\s+${sectionKey}\\s*$`, 'im');
    content = content.replace(sectionTitleRegex, '').trim();
    
    // Prepend proper level 1 heading with the appropriate section name based on the current language
    // This ensures consistent structure across all sections
    if (content) {
      content = `# ${title}\n\n${content}`;
    }
    
    return (
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
          <div className="flex gap-2">
            <button
              onClick={() => !isAnyGenerating && handleRegenerateSection(sectionKey)}
              className={`p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-full transition-opacity duration-200 ${isAnyGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={t('plan.regenerate')}
            >
              {generatingSections[sectionKey] ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </button>
            <button
              onClick={() => !isAnyGenerating && handleCopyToClipboard(content, sectionKey)}
              className={`px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-opacity duration-200 ${isAnyGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {copyStatus[sectionKey] ? t('common.copied') : t('buttons.copy')}
            </button>
          </div>
        </div>
        <div className="prose prose-sm md:prose-base lg:prose-lg dark:prose-invert max-w-none bg-gray-50 dark:bg-gray-800 p-4 rounded-lg compact-markdown">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <p>{t('plan.noContent')}</p>
          )}
        </div>
      </div>
    );
  };

  if (loading || sermonLoading) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <h1 className="text-xl text-red-600 mb-4">{error}</h1>
        <button 
          onClick={() => router.back()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {t('buttons.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Link 
            href={`/sermons/${id}`}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {t('buttons.backToSermon')}
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={() => !isAnyGenerating && handleGeneratePlan()}
              className={`px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-opacity duration-200 ${isAnyGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isGenerating ? t('plan.generating') : t('plan.generate')}
            </button>
            <button
              onClick={() => !isAnyGenerating && handleCopyFullPlan()}
              className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-opacity duration-200 ${isAnyGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {copyStatus.full ? t('common.copied') : t('plan.copyFullPlan')}
            </button>
          </div>
        </div>

        {successMessage && (
          <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-md">
            {successMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md">
            {error}
          </div>
        )}

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">{sermon?.title}</h1>
          <p className="text-gray-600 dark:text-gray-400">{sermon?.verse}</p>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          {renderSectionContent('introduction', t('outline.introduction'))}
          {renderSectionContent('main', t('outline.mainPoints'))}
          {renderSectionContent('conclusion', t('outline.conclusion'))}
        </div>
      </div>
      
      {/* Copy Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-3xl mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                {t('copy.title')}
              </h3>
              <button 
                onClick={() => setShowCopyModal(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex justify-center mb-4">
              <div className="inline-flex rounded-md shadow-sm" role="group">
                <button
                  type="button"
                  onClick={() => setIsFormattedText(false)}
                  className={`px-4 py-2 text-sm font-medium ${!isFormattedText 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'} 
                    border border-gray-200 dark:border-gray-600 rounded-l-lg`}
                >
                  {t('copy.markdown')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsFormattedText(true)}
                  className={`px-4 py-2 text-sm font-medium ${isFormattedText 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'} 
                    border border-gray-200 dark:border-gray-600 rounded-r-lg`}
                >
                  {t('copy.formatted')}
                </button>
              </div>
            </div>
            
            <div className="mt-4 mb-6">
              {!isFormattedText ? (
                <div className="overflow-auto max-h-96 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg whitespace-pre-wrap font-mono text-sm">
                  {currentCopyContent}
                </div>
              ) : (
                <div 
                  ref={formattedTextRef}
                  className="overflow-auto max-h-96 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg prose prose-sm md:prose-base dark:prose-invert max-w-none compact-markdown"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentCopyContent}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            
            <div className="flex justify-end">
              <button
                onClick={handleCopyFromModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                {copyStatus[currentCopySection] ? t('common.copied') : t('buttons.copy')}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Custom styling for compact markdown */}
      <style jsx global>{`
        .compact-markdown p {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .compact-markdown h1, .compact-markdown h2, .compact-markdown h3, 
        .compact-markdown h4, .compact-markdown h5, .compact-markdown h6 {
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        .compact-markdown ul, .compact-markdown ol {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
          padding-left: 1.5em;
        }
        .compact-markdown li {
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .compact-markdown li > p {
          margin-top: 0;
          margin-bottom: 0;
        }
        /* Remove borders from all elements */
        .compact-markdown * {
          border: none !important;
        }
      `}</style>
    </div>
  );
} 