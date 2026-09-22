"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import FormDialog from "@/components/ui/FormDialog";
import { isCollectionOnEngine } from "@/data-engine/react.client";
import { PreachDate, Church, PreachDateStatus } from "@/models/models";
import { isUnspecifiedChurch } from "@/utils/church";
import { getTodayDateOnlyKey, toDateOnlyKey } from "@/utils/dateOnly";
import {
    awaitAcceptance,
    type WriteSubmission,
} from "@/utils/recoverableWrite";

import { EnginePreachDateModal } from "./EnginePreachDateModal";
import { PreachDateFields } from "./PreachDateFields";

import type { DashboardSermonSyncState } from "@/models/dashboardOptimistic";

const SAVE_ERROR_KEY = 'common.saveError';


interface PreachDateModalProps {
    isOpen: boolean;
    sermonId: string;
    onClose: () => void;
    onSave: (
        data: Omit<PreachDate, 'id' | 'createdAt'>
    ) => WriteSubmission;
    initialData?: PreachDate;
    /**
     * The congregation the SERMON is prepared for, offered when this dated event does not
     * name one of its own. Marking a sermon preached opens this form with no date to read
     * from, so the field started blank and asked the person to retype a church the app
     * already knew. Never overrides a church the date itself names: a sermon travels, and
     * where it was actually preached is the date's own fact.
     */
    defaultChurch?: Church;
    defaultStatus?: PreachDateStatus;
    /** Terminal state from the dashboard mutation cache, which owns rollback. */
    syncState?: DashboardSermonSyncState;
}

export default function PreachDateModal(props: PreachDateModalProps) {
    if (isCollectionOnEngine('sermons')) return props.isOpen ? <EnginePreachDateModal key={`${props.sermonId}:${props.initialData?.id ?? 'new'}`} sermonId={props.sermonId}
        action={{ kind: props.initialData?.id ? 'edit' : 'add', dateId: props.initialData?.id, status: props.defaultStatus }} onClose={props.onClose} /> : null;
    return <LegacyPreachDateModal {...props} />;
}

function LegacyPreachDateModal({
    isOpen,
    onClose,
    onSave,
    initialData,
    defaultChurch,
    defaultStatus,
    syncState,
}: PreachDateModalProps) {
    const { t } = useTranslation();
    // ONE rule for "which congregation does this form open with", so the three doors that
    // open it cannot answer it three different ways.
    const openingChurch = (dated?: PreachDate): Church => {
        if (!isUnspecifiedChurch(dated?.church)) return dated!.church;
        if (!isUnspecifiedChurch(defaultChurch)) return defaultChurch as Church;
        return { id: "", name: "", city: "" };
    };
    const [date, setDate] = useState(toDateOnlyKey(initialData?.date) || getTodayDateOnlyKey());
    const [church, setChurch] = useState<Church>(openingChurch(initialData));
    const [audience, setAudience] = useState(initialData?.audience || "");
    const [notes, setNotes] = useState(initialData?.notes || "");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    useEffect(() => {
        if (initialData) {
            setDate(toDateOnlyKey(initialData.date) || getTodayDateOnlyKey());
            setAudience(initialData.audience || "");
            setNotes(initialData.notes || "");
        } else {
            setDate(getTodayDateOnlyKey());
            setAudience("");
            setNotes("");
        }
        setChurch(openingChurch(initialData));
        setSaveError("");
        // `openingChurch` is derived from exactly these inputs and nothing else.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData, isOpen, defaultChurch]);

    useEffect(() => {
        /**
         * NO `isSaving` GATE — it is cleared in `finally`, before the failed state
         * arrives, so an early refusal was silent while the covered badge could not
         * speak for it either.
         */
        if (syncState?.status !== 'error') return;

        setSaveError(
            syncState.refused || syncState.conflict
                ? t('writeRecovery.refused')
                : syncState.message || t(SAVE_ERROR_KEY)
        );
        setIsSaving(false);
    }, [syncState, t]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!church.name) return;

        const resolvedStatus = initialData ? initialData.status : defaultStatus;

        setIsSaving(true);
        setSaveError("");
        try {
            const submission = onSave({
                date,
                status: resolvedStatus,
                church,
                audience: audience.trim() || undefined,
                notes: notes.trim() || undefined,
            });

            await awaitAcceptance(submission, (error) => {
                // Reported by usePreachDates' recovery descriptor, which carries the
                // church, audience and notes — one refusal, one reporter.
                console.error('Preach date write refused after acceptance:', error);
            });
            onClose();
        } catch (error) {
            // Same reporter owns an early refusal; this editor stays open with the text.
            console.error('Preach date write refused:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const footer = (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-xl px-4 py-2.5 font-medium text-gray-600 transition hover:bg-gray-200/70 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
            >
                {t('buttons.cancel')}
            </button>
            <button
                type="submit"
                disabled={isSaving || !church.name}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isSaving && (
                    <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-b-transparent"
                        aria-hidden="true"
                    />
                )}
                <span>{isSaving ? t('buttons.saving') : t('buttons.save')}</span>
            </button>
        </div>
    );

    return (
        <FormDialog
            title={initialData ? t('calendar.editPreachDate') : t('calendar.addPreachDate')}
            onClose={onClose}
            onSubmit={handleSubmit}
            footer={footer}
            closeDisabled={isSaving}
        >
            <PreachDateFields value={{ date, church, audience, notes }} onChange={patch => {
                if (patch.date !== undefined) setDate(patch.date);
                if (patch.church !== undefined) setChurch(patch.church);
                if (patch.audience !== undefined) setAudience(patch.audience);
                if (patch.notes !== undefined) setNotes(patch.notes);
                setSaveError("");
            }} />

            {saveError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {saveError}
                </p>
            )}
        </FormDialog>
    );
}
