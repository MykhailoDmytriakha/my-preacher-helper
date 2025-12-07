import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, BookOpen, ScrollText } from 'lucide-react';
import { PlanStyle } from '@/api/clients/openAI.client';
import { motion } from 'framer-motion';

interface PlanStyleSelectorProps {
    value: PlanStyle;
    onChange: (style: PlanStyle) => void;
    disabled?: boolean;
}

export default function PlanStyleSelector({ value, onChange, disabled }: PlanStyleSelectorProps) {
    const { t } = useTranslation();

    const styles: { id: PlanStyle; icon: React.ReactNode; label: string; description: string }[] = [
        {
            id: 'memory',
            icon: <Sparkles className="w-4 h-4" />,
            label: t('plan.style.memory', { defaultValue: 'Memory Hooks' }),
            description: t('plan.style.memoryDesc', { defaultValue: 'Short, punchy, 3-6 words' })
        },
        {
            id: 'narrative',
            icon: <ScrollText className="w-4 h-4" />,
            label: t('plan.style.narrative', { defaultValue: 'Narrative Flow' }),
            description: t('plan.style.narrativeDesc', { defaultValue: 'Story-driven, smooth transitions' })
        },
        {
            id: 'exegetical',
            icon: <BookOpen className="w-4 h-4" />,
            label: t('plan.style.exegetical', { defaultValue: 'Exegetical' }),
            description: t('plan.style.exegeticalDesc', { defaultValue: 'Deep theological depth' })
        }
    ];

    return (
        <div className="flex flex-col gap-2 mb-6">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('plan.style.label', { defaultValue: 'Generation Style' })}
            </label>
            <div className="flex flex-wrap gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                {styles.map((style) => {
                    const isSelected = value === style.id;
                    return (
                        <button
                            key={style.id}
                            onClick={() => onChange(style.id)}
                            disabled={disabled}
                            className={`
                relative flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200
                ${isSelected
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
                        >
                            {isSelected && (
                                <motion.div
                                    layoutId="activeStyleBg"
                                    className="absolute inset-0 bg-white dark:bg-gray-700 rounded-md shadow-sm border border-gray-200 dark:border-gray-600"
                                    initial={false}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            )}
                            <span className="relative z-10 flex items-center gap-2">
                                {style.icon}
                                <span className="flex flex-col items-start text-left">
                                    <span>{style.label}</span>
                                    {/* Optional: Show description on hover or always if space permits? Keeping it simple for now */}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
                {styles.find(s => s.id === value)?.description}
            </p>
        </div>
    );
}
