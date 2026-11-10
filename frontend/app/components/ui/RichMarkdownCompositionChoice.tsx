'use client';

import { useTranslation } from '@locales/useTranslation';

import FormDialog, { FormButton } from './FormDialog';

interface Props {
    typed: string;
    updated: string;
    onChoose: (keepTyped: boolean) => void;
}

export function RichMarkdownCompositionChoice({ typed, updated, onChoose }: Props) {
    const { t } = useTranslation();

    return (
        <FormDialog
            title={t('richEditor.compositionChoice.title')}
            description={t('richEditor.compositionChoice.description')}
            onClose={() => undefined}
            closeDisabled
            layerClassName="z-[300]"
            footer={(
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                    <FormButton variant="secondary" onClick={() => onChoose(false)}>
                        {t('richEditor.compositionChoice.keepUpdated')}
                    </FormButton>
                    <FormButton onClick={() => onChoose(true)}>
                        {t('richEditor.compositionChoice.keepTyped')}
                    </FormButton>
                </div>
            )}
        >
            <section>
                <h3 className="font-medium">{t('richEditor.compositionChoice.typed')}</h3>
                <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words">{typed}</pre>
            </section>
            <section>
                <h3 className="font-medium">{t('richEditor.compositionChoice.updated')}</h3>
                <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words">{updated}</pre>
            </section>
        </FormDialog>
    );
}
