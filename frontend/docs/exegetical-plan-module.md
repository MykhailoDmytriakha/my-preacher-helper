# Exegetical Plan Module Documentation

## Overview
The Exegetical Plan Module is a comprehensive tool designed to help preachers create structured exegetical plans for biblical passages. It provides an interactive tree-based builder for organizing the flow and structure of the text being studied, following best practices in biblical exegesis.

## Features
- **Hierarchical Tree Builder**: Create and organize nested outline points with unlimited depth
- **Block Diagram Integration**: Future feature for visual text structure representation
- **Author Intent Tracking**: Document and save the original meaning the biblical author intended
- **Interactive Instructions**: Collapsible guidance on creating effective exegetical plans
- **Real-time Saving**: Automatic change detection with smart save buttons
- **Modular Architecture**: Clean separation of concerns for maintainability

## Architecture

### Module Structure
The module follows a modular architecture pattern with clear separation of concerns:

```
exegeticalPlan/
├── types.ts                    # TypeScript interfaces and types
├── treeUtils.ts                # Tree manipulation utility functions
├── TreeNode.tsx                # Individual tree node component
├── TreeBuilder.tsx             # Tree management and UI component
├── AuthorIntentSection.tsx     # Author intent input section
├── InstructionSection.tsx      # Collapsible instructions component
├── BlockDiagramSection.tsx     # Future block diagram feature
├── ExegeticalPlanModule.tsx    # Main module orchestrator
└── index.ts                    # Public API exports
```

### Components

#### ExegeticalPlanModule (Main Component)
The main orchestrator component that manages state and coordinates sub-components.

**Props:**
```typescript
{
  value?: ExegeticalPlanNode[];
  onChange?: (nodes: ExegeticalPlanNode[]) => void;
  onSave?: (nodes: ExegeticalPlanNode[]) => Promise<void> | void;
  saving?: boolean;
  authorIntent?: string;
  onSaveAuthorIntent?: (text: string) => Promise<void> | void;
}
```

#### TreeNode
Recursive component for rendering individual tree nodes with editing capabilities.

**Features:**
- Inline title editing
- Add child nodes
- Add sibling nodes
- Delete nodes
- Automatic focus management

#### TreeBuilder
Manages the tree structure display and provides controls for tree manipulation.

**Features:**
- Add main points
- Save tree changes
- Display unsaved changes indicator
- Empty state handling

#### AuthorIntentSection
Dedicated section for documenting the biblical author's intent.

**Features:**
- Multi-line text input
- Save/Cancel actions
- Change detection
- Loading states

#### InstructionSection
Collapsible educational content about creating exegetical plans.

**Features:**
- Toggle visibility
- Detailed instructions
- Example from 1 Peter
- Best practices guidance

#### BlockDiagramSection
Placeholder for future block diagram functionality.

**Features:**
- Coming soon badge
- Information tooltip
- Educational description

### Utility Functions

#### Tree Manipulation (`treeUtils.ts`)
- `createNodeId()`: Generate unique node IDs
- `createNewNode()`: Create new tree node with defaults
- `syncDraftTitles()`: Extract titles from tree to draft state
- `mergeDraftTitles()`: Merge draft titles back into tree
- `removeNode()`: Remove node from tree by ID
- `addChildNode()`: Add child to parent node
- `addSiblingNode()`: Add sibling after specified node
- `areTreesEqual()`: Deep comparison of tree structures

### Data Models

```typescript
interface ExegeticalPlanNode {
  id: string;
  title: string;
  children?: ExegeticalPlanNode[];
}

interface ExegeticalPlanModuleProps {
  value?: ExegeticalPlanNode[];
  onChange?: (nodes: ExegeticalPlanNode[]) => void;
  onSave?: (nodes: ExegeticalPlanNode[]) => Promise<void> | void;
  saving?: boolean;
  authorIntent?: string;
  onSaveAuthorIntent?: (text: string) => Promise<void> | void;
}
```

## Usage

### In Preparation Mode
The module is integrated as a step in the sermon preparation workflow:

```tsx
import ExegeticalPlanStepContent from '@/components/sermon/prep/ExegeticalPlanStepContent';

<PrepStepCard
  stepId="exegeticalPlan"
  stepNumber={3}
  title="Exegetical Plan"
  icon={<BookOpen />}
  isActive={activeStepId === 'exegeticalPlan'}
  isExpanded={isStepExpanded('exegeticalPlan')}
  onToggle={() => toggleStep('exegeticalPlan')}
  done={isExegeticalPlanDone}
>
  <ExegeticalPlanStepContent
    value={prepDraft?.exegeticalPlan || []}
    onChange={(nodes) => {
      setPrepDraft(prev => ({ ...(prev || {}), exegeticalPlan: nodes }));
    }}
    onSave={async (nodes) => {
      await savePreparation({ exegeticalPlan: nodes });
    }}
    saving={savingPrep}
    authorIntent={prepDraft?.authorIntent || ''}
    onSaveAuthorIntent={async (text: string) => {
      await savePreparation({ authorIntent: text });
    }}
  />
</PrepStepCard>
```

### Standalone Usage
Can also be used independently:

```tsx
import { ExegeticalPlanModule } from '@/components/sermon/prep/exegeticalPlan';

<ExegeticalPlanModule
  value={exegeticalPlan}
  onChange={setExegeticalPlan}
  onSave={handleSave}
  saving={isSaving}
  authorIntent={authorIntent}
  onSaveAuthorIntent={handleSaveIntent}
/>
```

## Localization
The module supports three languages with complete translations:
- **English**: `wizard.steps.exegeticalPlan.*`
- **Russian**: Full translation set in `ru/translation.json`
- **Ukrainian**: Full translation set in `uk/translation.json`

### Translation Keys
- `wizard.steps.exegeticalPlan.title` - Module title
- `wizard.steps.exegeticalPlan.intro` - Introduction text
- `wizard.steps.exegeticalPlan.builder.*` - Tree builder UI
- `wizard.steps.exegeticalPlan.authorIntent.*` - Author intent section
- `wizard.steps.exegeticalPlan.instruction.*` - Instructional content
- `wizard.steps.exegeticalPlan.blockDiagram.*` - Block diagram section

## Educational Content

### Simple Study of Text Structure
The module teaches users to create exegetical plans following these principles:

1. **Definition**: A passage plan is a structural expression of the main idea's development
2. **Requirements for Each Point**:
   - Must come from the text
   - Should reveal the main idea
   - Should be parallel with other points
   - Should be short, concise, and precise
3. **Goal**: Reflect the development of the passage's main idea

### Example (1 Peter 3:1-6)
The module includes a detailed example showing:
- Topic identification
- Commands and their purposes
- Character qualities (what testifies/doesn't testify)
- Biblical examples (Sarah and holy women)

## Change Detection
The module implements sophisticated change detection:

1. **Tree Changes**: Compares current draft state with saved values
2. **Author Intent Changes**: Tracks text modifications
3. **Smart Save Buttons**: 
   - Enabled only when changes exist
   - Visual feedback (green when saveable, gray when saved)
   - Prevents unnecessary save operations

## Error Handling
- Graceful handling of missing data
- Fallback to empty state when no data exists
- Safe crypto.randomUUID with fallback ID generation
- Proper async/await error boundaries

## Performance Considerations
- Memoized change detection to prevent unnecessary re-renders
- Callback-based handlers to avoid recreation
- Efficient tree traversal algorithms
- Minimal re-renders with focused state updates

## Future Enhancements
1. **Block Diagram Feature**: Visual representation of text structure
2. **AI-Assisted Plan Generation**: Suggest outline points based on passage
3. **Template Library**: Pre-built exegetical plan templates
4. **Export Functionality**: Export plans to various formats
5. **Collaborative Editing**: Share and collaborate on exegetical plans
6. **Version History**: Track changes over time

## Testing
The module includes comprehensive test coverage:
- Tree manipulation (add, delete, edit nodes)
- Save functionality
- Author intent editing
- Instruction visibility toggle
- Change detection logic

Run tests:
```bash
npm run test -- ExegeticalPlanStepContent.test.tsx
```

## Best Practices

### For Users
1. Start with the main points that emerge from the text
2. Use the instruction section for guidance
3. Keep points concise and parallel
4. Document the author's intent separately
5. Save regularly to avoid losing work

### For Developers
1. Maintain modular structure - keep files under 300 lines
2. Use utility functions for tree manipulation
3. Follow the established component pattern for new sections
4. Update translations in all three languages
5. Add tests for new functionality
6. Document complex logic with comments (in English)

## Related Documentation
- [Preparation Mode Logic](../app/components/sermon/prep/logic.ts)
- [Sermon Models](../app/models/models.ts)
- [Brainstorm Module](./brainstorm-module.md) - Similar module pattern
