"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { getSermonPlan, generateSermonPlan } from "@/services/plan.service";
import useSermon from "@/hooks/useSermon";
import useSermonValidator from "@/hooks/useSermonValidator";
import Link from "next/link";
import DashboardNav from "@/components/navigation/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { Plan } from "@/models/models";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@locales/i18n";
import { Copy, Check } from 'lucide-react';

export default function SermonOutlinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { sermon, loading: sermonLoading, setSermon } = useSermon(id);
  const { isPlanAccessible } = useSermonValidator(sermon);
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
  const [copyFeedback, setCopyFeedback] = useState<Record<string, boolean>>({
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

  // Redirect if sermon's thoughts are not all linked to outline points
  useEffect(() => {
    if (!sermonLoading && sermon && !isPlanAccessible) {
      router.push(`/sermons/${id}`);
    }
  }, [sermon, sermonLoading, isPlanAccessible, id, router]);

  useEffect(() => {
    const fetchPlan = async () => {
      if (!id) return;
      
      setLoading(true);
      setError(null);
      
      try {
        if (sermon === null) {
          // Sermon is still loading, wait for it
          return;
        }
        
        if (sermon && sermon.plan) {
          setPlan(sermon.plan);
        } else {
          // Don't attempt to generate a new plan automatically
        }
      } catch (err) {
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
      setError(`${t('plan.regenerateError')} ${section}`);
    } finally {
      setGeneratingSections(prev => ({ ...prev, [section]: false }));
    }
  };

  const handleOpenCopyModal = (text: string, section: string) => {
    setCurrentCopyContent(text);
    setCurrentCopySection(section);
    setShowCopyModal(true);
    setIsFormattedText(false);
    setCopyFeedback(prev => ({ ...prev, [section]: false }));
  };

  const handleCopyFromModal = () => {
    const copySuccess = () => {
      setCopyFeedback(prev => ({ ...prev, [currentCopySection]: true }));
      setTimeout(() => {
        setCopyFeedback(prev => ({ ...prev, [currentCopySection]: false }));
        if (!isFormattedText) {
          setShowCopyModal(false);
        }
      }, 1500);
    };

    if (isFormattedText && formattedTextRef.current) {
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(formattedTextRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
      try {
        document.execCommand('copy');
        copySuccess();
      } catch (err) {
        setError(t('errors.copyError'));
      }
      selection?.removeAllRanges();
      setShowCopyModal(false);
    } else {
      navigator.clipboard.writeText(currentCopyContent).then(
        copySuccess,
        (err) => {
          setError(t('errors.copyError'));
          setShowCopyModal(false);
        }
      );
    }
  };

  const handleCopyToClipboard = (text: string, section: string) => {
    handleOpenCopyModal(text, section);
  };

  const handleCopyFullPlan = () => {
    if (!plan) return;
    
    const fullText = [
      plan.introduction.outline || '',
      plan.main.outline || '',
      plan.conclusion.outline || ''
    ].filter(Boolean).join('\n\n');
    
    navigator.clipboard.writeText(fullText).then(() => {
      setCopyFeedback(prev => ({ ...prev, full: true }));
      setTimeout(() => setCopyFeedback(prev => ({ ...prev, full: false })), 1500);
    }).catch(err => {
      setError(t('errors.copyError'));
    });
  };

  const renderSectionContent = (sectionKey: 'introduction' | 'main' | 'conclusion', title: string) => {
    const sectionContent = plan?.[sectionKey]?.outline || '';
    const isSectionGenerating = generatingSections[sectionKey];
    const isSectionCopied = copyFeedback[sectionKey];

    return (
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{title}</h2>
          <div className="flex gap-2">
            <button
              onClick={() => handleCopyToClipboard(sectionContent, sectionKey)}
              disabled={isSectionCopied}
              className={`px-3 py-1.5 text-xs rounded-md transition-all flex items-center gap-1 ${isSectionCopied ? 'bg-green-100 text-green-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
            >
              {isSectionCopied ? <Check size={14} /> : <Copy size={14} />}
              {isSectionCopied ? t('common.copied') : t('common.copy')}
            </button>
            <button
              onClick={() => handleRegenerateSection(sectionKey)}
              disabled={isAnyGenerating}
              className="px-3 py-1.5 text-xs rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isSectionGenerating ? <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-blue-500"></div> : null}
              {isSectionGenerating ? t('common.generating') : t('common.regenerate')}
            </button>
          </div>
        </div>
        <div className="p-4 prose prose-sm sm:prose dark:prose-invert max-w-none">
          {isSectionGenerating ? (
            <div className="text-center py-4 text-gray-500">{t('common.generating')}...</div>
          ) : sectionContent ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{sectionContent}</ReactMarkdown>
          ) : (
            <p className="text-gray-500 italic">{t('plan.noContentYet')}</p>
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
              {copyFeedback.full ? t('common.copied') : t('plan.copyFullPlan')}
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
          <p className="text-gray-600 dark:text-gray-400 whitespace-pre-line">{sermon?.verse}</p>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          {renderSectionContent('introduction', t('outline.introduction'))}
          {renderSectionContent('main', t('outline.mainPoints'))}
          {renderSectionContent('conclusion', t('outline.conclusion'))}
        </div>
      </div>
      
      {showCopyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{t('copy.title')} - {t(`sections.${currentCopySection}`)}</h3>
            
            <div className="mb-4 flex justify-center">
              <div className="inline-flex rounded-md shadow-sm bg-gray-100 dark:bg-gray-700 p-1">
                <button 
                  onClick={() => setIsFormattedText(false)}
                  className={`px-4 py-2 rounded-l-md text-sm font-medium transition-colors ${!isFormattedText ? 'bg-blue-500 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >
                  {t('copy.markdown')}
                </button>
                <button 
                  onClick={() => setIsFormattedText(true)}
                  className={`px-4 py-2 rounded-r-md text-sm font-medium transition-colors ${isFormattedText ? 'bg-blue-500 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >
                  {t('copy.formatted')}
                </button>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded p-4 mb-4 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700">
              {isFormattedText ? (
                <div ref={formattedTextRef} className="prose prose-sm sm:prose dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentCopyContent}</ReactMarkdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-mono">{currentCopyContent}</pre>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowCopyModal(false)} 
                className="px-4 py-2 text-sm rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleCopyFromModal} 
                disabled={copyFeedback[currentCopySection]}
                className={`px-4 py-2 text-sm rounded-md text-white flex items-center justify-center gap-1.5 min-w-[120px] transition-colors ${copyFeedback[currentCopySection] ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {copyFeedback[currentCopySection] ? (
                  <>
                    <Check size={16} />
                    {t('common.copied')}
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    {isFormattedText ? t('copy.copyFormatted') : t('copy.copyMarkdown')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
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
        .compact-markdown * {
          border: none !important;
        }
      `}</style>
    </div>
  );
} 