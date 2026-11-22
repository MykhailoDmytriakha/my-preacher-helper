import { createContext, useContext, useRef } from 'react';

import { RichMarkdownEditor, type RichMarkdownEditorProps } from '@/components/ui/RichMarkdownEditor';

import type { useDataDocument } from '@/data-engine/react.client';
import type { PlanCellOpening } from '@/data-engine/sermonPlanCellSession';

type CellDocument = Pick<ReturnType<typeof useDataDocument>, 'capturePlanCellOpening' | 'editPlanCell'>;

export const PlanCellDocument = createContext<CellDocument | null>(null);

type PlanCellEditorProps = Extract<RichMarkdownEditorProps, { value: string }> & { nodeId: string; acceptsInput?: () => boolean };

export function PlanCellEditor({ nodeId, acceptsInput, ...props }: PlanCellEditorProps) {
  const document = useContext(PlanCellDocument);
  const candidate = document?.capturePlanCellOpening(nodeId, props.value);
  const opening = useRef<PlanCellOpening | undefined>(candidate);
  const witnessedOpening = useRef(false);
  const appliedMarkdown = useRef<string | undefined>(undefined);
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
    if (document && shown && (shown.text === previous || previous !== undefined && previous === appliedMarkdown.current || witnessed)) {
      opening.current = { ...shown, text };
      appliedMarkdown.current = undefined;
      void document.editPlanCell(shown, text).catch(() => props.onHoldText?.(text));
    }
    return accepted;
  };
  return <RichMarkdownEditor {...props} includeEditOpening onChange={edit}
    onEditAfterForeignValue={followInstalledValue} onOwnValueApplied={followOwnValue} />;
}
