import { createContext, useContext, useRef } from 'react';

import { RichMarkdownEditor, type RichMarkdownEditorProps } from '@/components/ui/RichMarkdownEditor';

import type { useDataDocument } from '@/data-engine/react.client';
import type { PlanCellOpening } from '@/data-engine/sermonPlanCellSession';

type CellDocument = Pick<ReturnType<typeof useDataDocument>, 'capturePlanCellOpening' | 'editPlanCell' | 'holdPlanCellAlternative'>
  & Partial<Pick<ReturnType<typeof useDataDocument>, 'backsUpPlanCell' | 'editUnverifiedPlanCell'>>;

export const PlanCellDocument = createContext<CellDocument | null>(null);

type ValueProps = Extract<RichMarkdownEditorProps, { value: string }>;
type PlanCellEditorProps = Omit<ValueProps, 'onHoldText'> & { nodeId: string; acceptsInput?: () => boolean };

export function PlanCellEditor({ nodeId, acceptsInput, ...props }: PlanCellEditorProps) {
  const document = useContext(PlanCellDocument);
  const candidate = document?.capturePlanCellOpening(nodeId, props.value);
  const opening = useRef<PlanCellOpening | undefined>(candidate);
  const witnessedOpening = useRef(false);
  const appliedMarkdown = useRef<string | undefined>(undefined);
  const choiceCopy = useRef<{ text: string } | null>(null);
  const holdCopy = (text: string) => document?.holdPlanCellAlternative?.(nodeId, text);
  const holdForChoice: NonNullable<ValueProps['onHoldText']> = (text) => {
    const copy = { text };
    choiceCopy.current = copy;
    const settle = holdCopy(text);
    return (keep, chosenWrite) => {
      if (choiceCopy.current === copy) choiceCopy.current = null;
      settle?.(keep, chosenWrite);
    };
  };
  const followInstalledValue = (installed: string) => {
    // This callback comes from the first edit on the installed document. A render alone
    // cannot move the opening forward while ProseMirror still owns the previous text.
    if (candidate?.text === installed) {
      opening.current = candidate;
      witnessedOpening.current = true;
      appliedMarkdown.current = undefined;
    }
  };
  const followOwnValue = (value: string, markdown: string) => {
    if (candidate?.text === value) {
      opening.current = candidate;
      appliedMarkdown.current = markdown;
    }
  };
  const edit: typeof props.onChange = (text, previous) => {
    if (props.editable === false || acceptsInput?.() === false) return;
    const accepted = props.onChange(text, previous);
    const shown = candidate && candidate.text === previous ? candidate : opening.current;
    const witnessed = witnessedOpening.current;
    witnessedOpening.current = false;
    if (!document) return accepted;
    let writing: Promise<void> | undefined;
    if (shown && (shown.text === previous || previous !== undefined && previous === appliedMarkdown.current || witnessed)) {
      opening.current = { ...shown, text };
      appliedMarkdown.current = undefined;
      writing = document.editPlanCell(shown, text, previous);
    } else if (previous !== undefined) {
      writing = document.editUnverifiedPlanCell?.(nodeId, text, previous);
    }
    // Admission is synchronous, even when its device receipt is pending.
    // The same words already have a recovery owner in that case.
    if (writing && !document.backsUpPlanCell?.(nodeId, text) && choiceCopy.current?.text !== text) {
      void writing.catch(() => { holdCopy(text); });
    }
    return writing ?? accepted;
  };
  return <RichMarkdownEditor {...props} includeEditOpening onChange={edit} onHoldText={holdForChoice}
    onEditAfterForeignValue={followInstalledValue} onOwnValueApplied={followOwnValue} />;
}
