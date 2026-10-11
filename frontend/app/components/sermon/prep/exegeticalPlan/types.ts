import type { ExegeticalPlanNode } from '@/models/models';

/** One change of the plan, applied to the newest plan the document holds. */
export type PlanEdit = (nodes: ExegeticalPlanNode[]) => ExegeticalPlanNode[];

export interface ExegeticalPlanModuleProps {
  value?: ExegeticalPlanNode[];
  /**
   * The plan lives in an open document (the data engine): each edit goes into it at once and the
   * document saves it. Given this, the module keeps no draft and ignores `onSave` / `saving`.
   */
  onEdit?: (edit: PlanEdit) => Promise<void> | void;
  onSave?: (nodes: ExegeticalPlanNode[]) => Promise<void> | void;
  saving?: boolean;
  authorIntent?: string;
  onSaveAuthorIntent?: (text: string) => Promise<void> | void;
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
  value: string;
  onChange: (value: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  hasChanges: boolean;
}

export interface InstructionSectionProps {
  isVisible: boolean;
  onToggle: () => void;
}
