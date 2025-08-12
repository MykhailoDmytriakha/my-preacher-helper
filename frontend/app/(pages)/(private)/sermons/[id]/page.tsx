"use client";

import { useState, useEffect, useRef, useCallback } from "react"; // Import useCallback
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import type { Sermon, Thought, Outline, Preparation } from "@/models/models";
import Link from "next/link";
import { getTags } from "@/services/tag.service";
import useSermon from "@/hooks/useSermon";
import ThoughtCard from "@components/ThoughtCard";
import AddThoughtManual from "@components/AddThoughtManual";
import EditThoughtModal from "@components/EditThoughtModal";
import SermonHeader from "@/components/sermon/SermonHeader"; // Import the SermonHeader
import KnowledgeSection from "@/components/sermon/KnowledgeSection";
import StructureStats from "@/components/sermon/StructureStats";
import StructurePreview from "@/components/sermon/StructurePreview";
import SermonOutline from "@/components/sermon/SermonOutline";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getContrastColor } from "@utils/color";
import { UI_COLORS } from "@utils/themeColors";
import { BookOpen, Sparkles, Wrench, AlertTriangle } from 'lucide-react';
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import ThoughtFilterControls from '@/components/sermon/ThoughtFilterControls';
import { STRUCTURE_TAGS } from '@lib/constants';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import ThoughtList from '@/components/sermon/ThoughtList'; // Import the new list component
import BrainstormModule from '@/components/sermon/BrainstormModule';
import { updateSermonPreparation } from '@/services/sermon.service';
export const dynamic = "force-dynamic";

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

export default function SermonPage() {
  // Formats standalone verse numbers (at start or surrounded by spaces) as superscript
  const formatSuperscriptVerses = useCallback((text: string): string => {
    if (!text) return text;
    // Superscript number at the very start if followed by a space
    let result = text.replace(/^(\d{1,3})(?=\s)/, '<sup class="text-gray-300 dark:text-gray-600">$1</sup>');
    // Superscript numbers that are surrounded by spaces
    result = result.replace(/(\s)(\d{1,3})(?=\s)/g, '$1<sup class="text-gray-300 dark:text-gray-600">$2</sup>');
    return result;
  }, []);
  // UI mode synced with query param (?mode=prep)
  const searchParams = useSearchParams();
  const initialMode = (searchParams?.get('mode') === 'prep') ? 'prep' : 'classic';
  const [uiMode, setUiMode] = useState<'classic' | 'prep'>(initialMode);
  useEffect(() => {
    const mode = (searchParams?.get('mode') === 'prep') ? 'prep' : 'classic';
    setUiMode(mode);
  }, [searchParams]);
  const { id } = useParams<{ id: string }>();
  const { sermon, setSermon, loading, refreshSermon } = useSermon(id);
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState<Preparation>({});

  useEffect(() => {
    if (sermon?.preparation) setPrepDraft(sermon.preparation);
  }, [sermon?.preparation]);

  const savePreparation = useCallback(async (partial: Preparation) => {
    if (!sermon) return;
    setSavingPrep(true);
    const next: Preparation = { ...(sermon.preparation ?? {}), ...partial };
    const updated = await updateSermonPreparation(sermon.id, next);
    if (updated) setSermon(prev => (prev ? { ...prev, preparation: updated } : prev));
    setSavingPrep(false);
  }, [sermon, setSermon]);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false); // Keep this state for dropdown visibility

  // Use the custom hook for filtering logic
  const { 
    filteredThoughts, 
    activeCount, 
    viewFilter, 
    setViewFilter, 
    structureFilter, 
    setStructureFilter, 
    tagFilters, 
    toggleTagFilter, 
    resetFilters, 
    sortOrder, 
    setSortOrder, 
    hasStructureTags 
  } = useThoughtFiltering({
    initialThoughts: sermon?.thoughts ?? [],
    sermonStructure: sermon?.structure // Pass structure to hook
  });
  
  // Ref for the filter toggle button (passed to controls)
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchAllowedTags = async () => {
      if (sermon) {
        try {
          const tagData = await getTags(sermon.userId);
          const combinedTags = [
            ...tagData.requiredTags.map((t: any) => ({ name: t.name, color: t.color })),
            ...tagData.customTags.map((t: any) => ({ name: t.name, color: t.color })),
          ];
          setAllowedTags(combinedTags);
        } catch (error) {
          console.error("Error fetching allowed tags:", error);
        }
      }
    };
    fetchAllowedTags();
  }, [sermon]);

  // Calculate the number of thoughts for each outline point
  const calculateThoughtsPerOutlinePoint = () => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return {};
    
    const counts: Record<string, number> = {};
    
    // Count thoughts for each outline point ID
    sermon.thoughts.forEach(thought => {
      if (thought.outlinePointId) {
        counts[thought.outlinePointId] = (counts[thought.outlinePointId] || 0) + 1;
      }
    });
    
    return counts;
  };

  const thoughtsPerOutlinePoint = calculateThoughtsPerOutlinePoint();

  // Проверяем, есть ли мысли с несогласованностью между тегами и назначенными пунктами плана
  const checkForInconsistentThoughts = (): boolean => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return false;
    
    // Соответствие между секциями и тегами
    const sectionTagMapping: Record<string, string> = {
      'introduction': STRUCTURE_TAGS.INTRODUCTION,
      'main': STRUCTURE_TAGS.MAIN_BODY,
      'conclusion': STRUCTURE_TAGS.CONCLUSION
    };
    
    // Список обязательных тегов для проверки
    const requiredTags = Object.values(sectionTagMapping);
    
    // Проверяем каждую мысль
    return sermon.thoughts.some(thought => {
      // 1. Проверка на несколько обязательных тегов у одной мысли
      const usedRequiredTags = thought.tags.filter(tag => requiredTags.includes(tag));
      if (usedRequiredTags.length > 1) {
        return true; // Несогласованность: несколько обязательных тегов
      }
      
      // 2. Проверка на несогласованность между тегом и назначенным пунктом плана
      if (!thought.outlinePointId) return false; // Если нет назначенного пункта плана, нет и проблемы
      
      // Определяем секцию пункта плана
      let outlinePointSection: string | undefined;
      
      if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'introduction';
      } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'main';
      } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'conclusion';
      }
      
      if (!outlinePointSection) return false; // Если не нашли секцию, считаем что проблемы нет
      
      // Получаем ожидаемый тег для текущей секции
      const expectedTag = sectionTagMapping[outlinePointSection];
      if (!expectedTag) return false; // Если неизвестная секция, считаем что все в порядке
      
      // Проверяем, имеет ли мысль тег соответствующей секции
      const hasExpectedTag = thought.tags.includes(expectedTag);
      
      // Проверяем, имеет ли мысль теги других секций
      const hasOtherSectionTags = Object.values(sectionTagMapping)
        .filter(tag => tag !== expectedTag)
        .some(tag => thought.tags.includes(tag));
      
      // Несогласованность, если нет ожидаемого тега или есть теги других секций
      return !(!hasOtherSectionTags || hasExpectedTag);
    });
  };
  
  // Проверяем наличие несогласованностей
  const hasInconsistentThoughts = checkForInconsistentThoughts();

  // Function to update only the outline part of the sermon state
  const handleOutlineUpdate = (updatedOutline: Outline) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        outline: updatedOutline,
      };
    });
  };

  // Callback function to update sermon state after title edit
  const handleSermonUpdate = useCallback((updatedSermon: Sermon) => {
    setSermon(updatedSermon);
  }, [setSermon]);

  if (loading || !sermon) {
    return (
      <div className="py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          {isMounted ? (
            <>
              <h2 className="text-xl font-semibold">{t('settings.loading')}</h2>
              <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
                {t('sermon.backToList')}
              </Link>
            </>
          ) : (
            <div className="animate-pulse">
              <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!sermon.thoughts) {
    sermon.thoughts = [];
  }
  const totalThoughts = sermon.thoughts.length;
  const tagCounts = {
    [STRUCTURE_TAGS.INTRODUCTION]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.INTRODUCTION) ? 1 : 0),
      0
    ),
    [STRUCTURE_TAGS.MAIN_BODY]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.MAIN_BODY) ? 1 : 0),
      0
    ),
    [STRUCTURE_TAGS.CONCLUSION]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.CONCLUSION) ? 1 : 0),
      0
    ),
  };

  const handleNewRecording = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setStoredAudioBlob(audioBlob);
    setTranscriptionError(null);
    setRetryCount(0);
    
    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id, 0, 3);
      const newThought: Thought = { ...thoughtResponse };
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...(prevSermon.thoughts ?? [])] }
          : prevSermon
      );
      
      // Clear stored audio on success
      setStoredAudioBlob(null);
      setTranscriptionError(null);
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      setTranscriptionError(error instanceof Error ? error.message : 'Unknown error occurred');
      
      // Don't show alert here - let the AudioRecorder component handle the UI
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!storedAudioBlob) return;
    
    setIsProcessing(true);
    const newRetryCount = retryCount + 1;
    setRetryCount(newRetryCount);
    setTranscriptionError(null);
    
    try {
      const thoughtResponse = await createAudioThought(storedAudioBlob, sermon.id, newRetryCount, 3);
      const newThought: Thought = { ...thoughtResponse };
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...(prevSermon.thoughts ?? [])] }
          : prevSermon
      );
      
      // Clear stored audio on success
      setStoredAudioBlob(null);
      setTranscriptionError(null);
      setRetryCount(0);
    } catch (error) {
      console.error("handleRetryTranscription: Recording error:", error);
      setTranscriptionError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (thoughtId: string) => {
    const thoughtToDelete = sermon.thoughts.find(t => t.id === thoughtId);
    if (!thoughtToDelete) {
      console.error("Could not find thought with ID:", thoughtId);
      alert(t('errors.thoughtDeleteError'));
      return;
    }
    
    const confirmed = window.confirm(t('sermon.deleteThoughtConfirm', { text: thoughtToDelete.text }));
    if (!confirmed) return;
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon((prevSermon) => prevSermon ? {
        ...prevSermon,
        thoughts: prevSermon.thoughts.filter(t => t.id !== thoughtId),
      } : null);
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert(t('errors.thoughtDeleteError'));
    }
  };

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!editingModalData) return;
    const originalThoughtId = editingModalData.thought.id;

    const thoughtIndex = sermon.thoughts.findIndex(t => t.id === originalThoughtId);
    if (thoughtIndex === -1) {
      console.error("Could not find thought with ID:", originalThoughtId);
      alert(t('errors.thoughtUpdateError'));
      setEditingModalData(null);
      return;
    }
    
    const thoughtToUpdate = sermon.thoughts[thoughtIndex];
    const updatedThoughtData = { 
      ...thoughtToUpdate, 
      text: updatedText.trim(), 
      tags: updatedTags,
      outlinePointId
    };

    try {
      await updateThought(sermon.id, updatedThoughtData);
      setSermon((prevSermon) => {
        if (!prevSermon) return null;
        const newThoughts = [...prevSermon.thoughts];
        newThoughts[thoughtIndex] = updatedThoughtData;
        return { ...prevSermon, thoughts: newThoughts };
      });
      setEditingModalData(null);
    } catch (error) {
      console.error("Failed to update thought", error);
      alert(t('errors.thoughtUpdateError'));
    }
  };

  const handleNewManualThought = (newThought: Thought) => {
    setSermon((prevSermon) => prevSermon ? {
      ...prevSermon,
      thoughts: [newThought, ...(prevSermon.thoughts ?? [])],
    } : null);
  };

  const handleEditThoughtStart = (thought: Thought, index: number) => {
    setEditingModalData({ thought, index });
  };

  return (
    <div className="space-y-4 sm:space-y-6 py-4 sm:py-8">
        <SermonHeader sermon={sermon} onUpdate={handleSermonUpdate} />
        
        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false} mode="popLayout">
            {uiMode === 'classic' && (
              <motion.section layout
                key="recorder"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeInOut' } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeInOut' } }}
              >
                <AudioRecorder 
                  onRecordingComplete={handleNewRecording} 
                  isProcessing={isProcessing}
                  onRetry={handleRetryTranscription}
                  retryCount={retryCount}
                  maxRetries={3}
                  transcriptionError={transcriptionError}
                />
              </motion.section>
            )}
          </AnimatePresence>
        </MotionConfig>

        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false} mode="popLayout">
            {uiMode === 'classic' && (
              <motion.section layout
                key="brainstorm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeInOut' } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeInOut' } }}
              >
                <BrainstormModule sermonId={sermon.id} />
              </motion.section>
            )}
          </AnimatePresence>
        </MotionConfig>

        <motion.div
          layout
          className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 ${uiMode === 'prep' ? 'prep-mode' : ''}`}
          transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
        >
          <motion.div
            layout
            className="lg:col-span-2 space-y-4 sm:space-y-6"
            transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
          >
            <div className={`p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${uiMode === 'prep' ? 'ring-1 ring-fuchsia-300/40' : ''}`}>
              <MotionConfig reducedMotion="user">
                <AnimatePresence initial={false} mode="popLayout">
                  {uiMode === 'prep' ? (
                    <motion.div layout
                      key="prepPanel"
                      className="space-y-4"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeInOut' } }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeInOut' } }}
                    >
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                      <Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />
                    </div>
                    <h2 className="text-lg font-semibold">{t('wizard.steps.spiritual.title')}</h2>
                  </div>

                  {/* Reading passage intro */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                      <span className="text-gray-700 dark:text-gray-300">Перед началом прочитайте текст</span>
                    </div>
                    <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
                      <div
                        className="text-sm whitespace-pre-line leading-6 text-gray-800 dark:text-gray-100"
                        dangerouslySetInnerHTML={{
                          __html: formatSuperscriptVerses(
                            `9 О пророках. Сердце мое во мне раздирается, все кости мои сотрясаются; я - как пьяный, как человек, которого одолело вино, ради Господа и ради святых слов Его, 10 потому что земля наполнена прелюбодеями, потому что плачет земля от проклятия; засохли пастбища пустыни, и стремление их - зло, и сила их - неправда, 11 ибо и пророк и священник - лицемеры; даже в доме Моем Я нашел нечестие их, говорит Господь. 12 За то путь их будет для них, как скользкие места в темноте: их толкнут, и они упадут там; ибо Я наведу на них бедствие, год посещения их, говорит Господь. 13 И в пророках Самарии Я видел безумие; они пророчествовали именем Ваала, и ввели в заблуждение народ Мой, Израиля. 14 Но в пророках Иерусалима вижу ужасное: они прелюбодействуют и ходят во лжи, поддерживают руки злодеев, чтобы никто не обращался от своего нечестия; все они предо Мною - как Содом, и жители его - как Гоморра. 15 Посему так говорит Господь Саваоф о пророках: вот, Я накормлю их полынью и напою их водою с желчью, ибо от пророков Иерусалимских нечестие распространилось на всю землю. 16 Так говорит Господь Саваоф: не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних. 17 Они постоянно говорят пренебрегающим Меня: "Господь сказал: мир будет у вас". И всякому, поступающему по упорству своего сердца, говорят: "не придет на вас беда". 18 Ибо кто стоял в совете Господа и видел и слышал слово Его? Кто внимал слову Его и услышал? 19 Вот, идет буря Господня с яростью, буря грозная, и падет на главу нечестивых. 20 Гнев Господа не отвратится, доколе Он не совершит и доколе не выполнит намерений сердца Своего; в последующие дни вы ясно уразумеете это. 21 Я не посылал пророков сих, а они сами побежали; Я не говорил им, а они пророчествовали. 22 Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их. 23 Разве Я - Бог [только] вблизи, говорит Господь, а не Бог и вдали? 24 Может ли человек скрыться в тайное место, где Я не видел бы его? говорит Господь. Не наполняю ли Я небо и землю? говорит Господь. 25 Я слышал, что говорят пророки, Моим именем пророчествующие ложь. Они говорят: "мне снилось, мне снилось". 26 Долго ли это будет в сердце пророков, пророчествующих ложь, пророчествующих обман своего сердца? 27 Думают ли они довести народ Мой до забвения имени Моего посредством снов своих, которые они пересказывают друг другу, как отцы их забыли имя Мое из-за Ваала? 28 Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно. Что общего у мякины с чистым зерном? говорит Господь. 29 Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу? 30 Посему, вот Я - на пророков, говорит Господь, которые крадут слова Мои друг у друга. 31 Вот, Я - на пророков, говорит Господь, которые действуют своим языком, а говорят: "Он сказал". 32 Вот, Я - на пророков ложных снов, говорит Господь, которые рассказывают их и вводят народ Мой в заблуждение своими обманами и обольщением, тогда как Я не посылал их и не повелевал им, и они никакой пользы не приносят народу сему, говорит Господь. (Иер.23:9-32)`
                            )
                              .replace(
                                'не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних.',
                                '<u>не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних.</u>'
                              )
                              .replace(
                                'Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их.',
                                '<u>Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их.</u>'
                              )
                              .replace(
                                'Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно.',
                                '<u>Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно.</u>'
                              )
                              .replace(
                                'Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу?',
                                '<u>Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу?</u>'
                              ),
                        }}
                      />
                    </div>
                  </div>

                  {/* Reflections before preparation */}
                  <div className="mt-4">
                    <h3 className="text-base font-semibold">Размышления перед подготовкой</h3>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                          <h4 className="text-sm font-semibold">Духовная часть</h4>
                        </div>
                        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                        <li>
                          Неем 8:8: "
                          <sup className="text-gray-300 dark:text-gray-800">8</sup>
                          {' '}И читали из книги, из закона Божия, внятно, и присоединяли толкование, и народ понимал прочитанное."
                        </li>
                        <li>Проповедь в Силе Духа, сильная проповедь исходит не от проповедника, а от Духа Святого</li>
                        <li>
                          Проповедь Божьих истин и Божьего слова, а не человеческой мудрости.
                          <div className="mt-1 ml-4">
                            <div className="text-[13px] text-gray-700 dark:text-gray-300">Потому что только Божье Слово может менять людей, и имеет абсолютный авторитет</div>
                          </div>
                        </li>
                        <li>После проповеди, что люди скажут: какой хороший проповедник или какой великий Бог?</li>
                        <li>
                          Проповедь должна оказывать пронизывающий эффект на самого проповедника в процессе подготовки.
                          <div className="mt-1 ml-4">
                            <div className="text-[13px] text-gray-700 dark:text-gray-300">Слово Божье полезно для проповедника, и оно должно иметь эффект на проповедника</div>
                          </div>
                        </li>
                        </ul>
                      </div>
                      <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Wrench className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                          <h4 className="text-sm font-semibold">Техническая часть</h4>
                        </div>
                        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                          <li>Ты как режиссёр: спланируй как ты поведешь слушателей к Библейской истине</li>
                          <li>Проповедник не повар, он официант: так что нужно получить рецепт от Бога</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Prayer section and confirmation */}
                  <div className="mt-6">
                    <h3 className="text-base font-semibold">Молитва</h3>
                    <div className={`mt-2 p-3 rounded-md border-l-4 ${UI_COLORS.danger.border} dark:${UI_COLORS.danger.darkBorder} ${UI_COLORS.danger.bg} dark:${UI_COLORS.danger.darkBg} flex items-start gap-2`}>
                      <AlertTriangle className={`${UI_COLORS.danger.text} dark:${UI_COLORS.danger.darkText} w-4 h-4 mt-0.5`} />
                      <p className={`text-sm font-extrabold ${UI_COLORS.danger.text} dark:${UI_COLORS.danger.darkText}`}>Этот шаг нельзя пропускать, ни при каких обстоятельствах</p>
                    </div>
                  </div>

                  {/* Combined confirmation checkbox */}
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      id="readAndPrayed"
                      type="checkbox"
                      className="h-4 w-4"
                      checked={Boolean(prepDraft?.spiritual?.readAndPrayedConfirmed)}
                      onChange={(e) => {
                        const next: Preparation = {
                          ...prepDraft,
                          spiritual: { ...(prepDraft.spiritual ?? {}), readAndPrayedConfirmed: e.target.checked },
                        };
                        setPrepDraft(next);
                        savePreparation(next);
                      }}
                    />
                    <label htmlFor="readAndPrayed" className="text-sm">Отметьте, когда прочитали и помолились</label>
                  </div>

                  <div className="text-xs text-gray-500">{savingPrep ? 'Сохранение...' : 'Сохранено'}</div>
                    </motion.div>
                  ) : (
                    <motion.div layout
                      key="classicPanel"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeInOut' } }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeInOut' } }}
                    >
              <>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {activeCount} / {totalThoughts}
                  </span>
                  
                  <div className="relative ml-0 sm:ml-3">
                    <button
                      ref={filterButtonRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFilterOpen(!isFilterOpen);
                      }}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                      data-testid="thought-filter-button"
                    >
                      {t('filters.filter')}
                      {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                        <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                      )}
                      <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    <ThoughtFilterControls 
                      isOpen={isFilterOpen}
                      setIsOpen={setIsFilterOpen}
                      viewFilter={viewFilter}
                      setViewFilter={setViewFilter}
                      structureFilter={structureFilter}
                      setStructureFilter={setStructureFilter}
                      tagFilters={tagFilters}
                      toggleTagFilter={toggleTagFilter}
                      resetFilters={resetFilters}
                      sortOrder={sortOrder}
                      setSortOrder={setSortOrder}
                      allowedTags={allowedTags}
                      hasStructureTags={hasStructureTags}
                      buttonRef={filterButtonRef}
                    />
                  </div>
                </div>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-5">
                {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                  <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      {t('filters.activeFilters')}:
                    </span>
                    
                    {viewFilter === 'missingTags' && (
                      <span className="px-2 py-1 text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                        {t('filters.missingTags')}
                      </span>
                    )}
                    
                    {structureFilter !== 'all' && (
                      <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full">
                        {t(`tags.${structureFilter.toLowerCase().replace(/\s+/g, '_')}`)}
                      </span>
                    )}
                    
                    {sortOrder === 'structure' && (
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                        {t('filters.sortByStructure') || 'Sorted by Structure'}
                      </span>
                    )}
                    
                    {tagFilters.map((tag: string) => {
                      const tagInfo = allowedTags.find(t => t.name === tag);
                      return (
                        <span 
                          key={tag}
                          className="px-2 py-1 text-xs rounded-full"
                          style={{ 
                            backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0',
                            color: tagInfo ? getContrastColor(tagInfo.color) : '#000000' 
                          }}
                        >
                          {tag}
                        </span>
                      );
                    })}
                    
                    <button 
                      onClick={resetFilters}
                      className="ml-auto mt-2 sm:mt-0 px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md transition-colors"
                    >
                      {t('filters.clear')}
                    </button>
                  </div>
                )}
                
                <ThoughtList
                  filteredThoughts={filteredThoughts}
                  totalThoughtsCount={totalThoughts}
                  allowedTags={allowedTags}
                  sermonOutline={sermon?.outline}
                  onDelete={handleDeleteThought}
                  onEditStart={handleEditThoughtStart}
                  resetFilters={resetFilters}
                />
              </div>
              </>
                    </motion.div>
                  )}
                </AnimatePresence>
              </MotionConfig>
            </div>
          </motion.div>

          <motion.div
            layout
            className="space-y-6"
            transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
          >
            <StructureStats 
              sermon={sermon} 
              tagCounts={tagCounts} 
              totalThoughts={totalThoughts} 
              hasInconsistentThoughts={hasInconsistentThoughts} 
            />
            <KnowledgeSection sermon={sermon} updateSermon={handleSermonUpdate}/>
            <SermonOutline 
              sermon={sermon} 
              thoughtsPerOutlinePoint={thoughtsPerOutlinePoint} 
              onOutlineUpdate={handleOutlineUpdate}
            />
            {sermon.structure && <StructurePreview sermon={sermon} />}
          </motion.div>
        </motion.div>
      {editingModalData && (
        <EditThoughtModal
          thoughtId={editingModalData.thought.id}
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          initialOutlinePointId={editingModalData.thought.outlinePointId}
          allowedTags={allowedTags}
          sermonOutline={sermon.outline}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
    </div>
  );
}