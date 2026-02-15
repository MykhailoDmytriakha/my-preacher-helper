import type { ExegeticalPlanNode } from '@/models/models';

export interface ExegeticalPlanModuleProps {
  value?: ExegeticalPlanNode[];
  onChange?: (nodes: ExegeticalPlanNode[]) => void;
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
  onTitleChange: (id: string, value: string) => void;
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
