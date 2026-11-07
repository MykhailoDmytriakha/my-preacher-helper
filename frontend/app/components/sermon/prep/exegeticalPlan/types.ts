import type { PreparationTextBinding } from '@/components/common/manualTextBinding';
import type { ExegeticalPlanNode } from '@/models/models';

/** One change of the plan, applied to the newest plan the document holds. */
export type PlanEdit = (nodes: ExegeticalPlanNode[]) => ExegeticalPlanNode[];

export interface ExegeticalPlanModuleProps {
  /** Owner/resource/session shown by this module; a new subject retires open questions. */
  subject?: unknown;
  value?: ExegeticalPlanNode[];
  /**
   * The plan lives in an open document (the data engine): each edit goes into it at once and the
   * document saves it. Given this, the module keeps no draft and ignores `onSave` / `saving`.
   */
  onEdit?: (edit: PlanEdit) => Promise<void> | void;
  /** An explicit deletion joins the durable queue immediately. */
  onCommitRemoval?: (edit: PlanEdit) => Promise<void>;
  /** Retry the existing draft and request without applying the removal twice. */
  onRetryRemoval?: () => Promise<void>;
  onSave?: (nodes: ExegeticalPlanNode[]) => Promise<void> | void;
  saving?: boolean;
  authorIntentField?: PreparationTextBinding;
  /** The sermon whose prep this is, and the notes it was made from: its analysis stands as the block diagram. */
  sermonId?: string;
  sourceNoteIds?: string[];
}

export interface TreeNodeProps {
  node: ExegeticalPlanNode;
  depth?: number;
  index?: number;
  draftTitles: Record<string, string>;
  focusedId: string | null;
  /** May return the document's answer: a refusal lets the field show the document again. */
  onTitleChange: (id: string, value: string) => Promise<unknown> | void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onRemove: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onPromote: (id: string) => void;
  onDemote: (id: string) => void;
  expand: Record<string, boolean>;
}

export interface AuthorIntentSectionProps {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel?: () => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  hasChanges: boolean;
}

export interface InstructionSectionProps {
  isVisible: boolean;
  onToggle: () => void;
}
