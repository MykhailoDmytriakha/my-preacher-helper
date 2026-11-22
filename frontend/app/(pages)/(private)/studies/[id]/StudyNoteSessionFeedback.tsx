'use client';

import { studyNoteReferenceComparison } from '@/components/studyNoteReferenceComparison';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { readDocumentTagComparison, readStudyNoteFieldsComparison, readStudyNoteReferenceComparison, useRecoveryDiscovery } from '@/data-engine/react.client';
import { resolveAppLocale } from '@/utils/appLocale';
import { fieldLabel } from '@/utils/storedFieldLabel';
import { useTranslation } from '@locales/useTranslation';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { useDataDocument } from '@/data-engine/react.client';

export function StudyNoteSessionFeedback({ document, onRecover }: {
    document: ReturnType<typeof useDataDocument>;
    onRecover: () => void;
}) {
    const { t, language } = useTranslation();
    const checkpoint = document.state?.checkpoint;
    const fields = checkpoint && readStudyNoteFieldsComparison(checkpoint);
    const phase = document.status?.phase;
    const canRecover = Boolean(document.state?.durable && (phase === 'saved' || phase === 'deleted'));
    const recovery = useRecoveryDiscovery({
        identity: document.recoveryIdentity,
        enabled: canRecover,
        version: JSON.stringify([document.confirmed?.metadata?.generation, document.confirmed?.metadata?.revision, phase]),
        list: async () => (await document.listRecoverable()).map(source => {
            const draft = source.record.checkpoint.draft;
            return { id: source.id,
                title: (typeof draft?.title === 'string' && draft.title.trim()) || t('studiesWorkspace.untitled'),
                preview: typeof draft?.content === 'string' ? draft.content : undefined,
                discard: () => document.discardRecovery(source) };
        }),
        recover: async id => { await document.recover(id); onRecover(); },
    });
    const references = checkpoint && readStudyNoteReferenceComparison(checkpoint);
    const tags = checkpoint && readDocumentTagComparison(checkpoint);
    const fieldText = (side: 'mine' | 'stored') => fields?.map(field => {
        const text = (field.field === 'type' ? t('studiesWorkspace.type.' + field[side]) : field[side]) || t('dataSync.emptyField');
        return fields.length > 1 ? fieldLabel(t, field.field) + '\n' + text : text;
    }).join('\n\n') ?? '';
    const tagText = (side: 'mine' | 'stored') => tags?.choices.map(choice => choice.tag + ' · '
        + t(choice[side] ? 'thought.tagHistory.added' : 'thought.tagHistory.removed')).join('\n') ?? '';
    const sharedChoice = { local: t('dataSync.useLocalVersion'), stored: t('dataSync.useStoredVersion'),
        confirmStored: 'dataSync.confirmStoredFields' as const };
    const comparison: TextComparison | undefined = fields?.length ? {
        identity: JSON.stringify([checkpoint?.remoteCandidate?.metadata?.revision, fields]),
        valueKind: 'field', scopedChoice: true,
        title: fields.length === 1 ? fieldLabel(t, fields[0].field) : undefined,
        mine: fieldText('mine'), stored: fieldText('stored'),
        ...(fields.length > 1 && { description: t('dataSync.noteFieldsChanged'), actions: sharedChoice }),
    } : references && (references.rows.length || references.fields.length) ? {
        ...studyNoteReferenceComparison(references.rows, t, resolveAppLocale(language), references.fields),
        identity: references.identity, scopedChoice: true,
        ...(references.fields.length > 0 && references.rows.length > 0 && { actions: sharedChoice }),
    } : tags ? {
        identity: tags.identity, scopedChoice: true, valueKind: 'field', title: t('studiesWorkspace.tagComparison'),
        mine: tagText('mine'), stored: tagText('stored'),
    } : undefined;
    return <DataSyncStatus subject={document.recoveryIdentity} status={document.status}
        error={document.error} errorWords={document.errorWords} onRetry={document.retry}
        comparison={comparison} onKeepLocal={() => document.keepLocal(checkpoint)}
        onAcceptRemote={() => document.acceptRemote(checkpoint)}
        recoveryChoices={canRecover ? recovery.choices : []} recoveryLoading={recovery.loading}
        recoveryError={canRecover ? recovery.error : null} onRecover={recovery.recover}
        onDiscardRecovery={recovery.discard} />;
}
