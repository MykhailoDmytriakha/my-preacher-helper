# Drag & Drop Visual Jumping Fix Tests

## Overview

This test file (`structure-drag-drop-fix.test.tsx`) specifically covers the critical bug fix for the visual "jumping" issue that occurred during drag & drop operations in the sermon structure interface.

## The Problem

When users dragged sermon thoughts from one placeholder to another (e.g., from ambiguous to introduction), they experienced a visual glitch where the card would briefly "jump back" to its original position before settling in the target location. This happened specifically when:

1. Moving thoughts between different outline point placeholders
2. The operation required updating the `outlinePointId` property of the thought
3. The UI was waiting for asynchronous API calls to complete

## The Root Cause

The issue was caused by **double UI updates**:
1. Initial optimistic update during drag operation
2. Second update after API call completion (which briefly reverted the visual state)

## The Solution

Our fix implemented three key changes:

### 1. Immediate Local State Updates
- `outlinePointId` is updated in local state **immediately** during `handleDragEnd`
- UI reflects the change instantly, preventing visual jumping

### 2. Debounced API Calls
- Use `debouncedSaveThought` instead of direct `await updateThought`
- API calls happen in background without blocking UI
- Prevents second UI update that caused jumping

### 3. Proper Operation Sequence
- Local state update happens **first** (immediate visual feedback)
- API calls happen **second** (background, non-blocking)
- Error handling with rollback for failed API calls

## Test Coverage

### Test 1: `should fix visual jumping by updating outlinePointId immediately in local state`
**Purpose**: Verifies the core fix implementation

**What it tests**:
- ✅ `outlinePointId` is updated in local state immediately
- ✅ Debounced save is used instead of direct `updateThought`
- ✅ No blocking API calls that would cause UI delays
- ✅ Structure updates are properly handled

### Test 2: `should update local state before API calls to prevent visual jumping`
**Purpose**: Ensures correct operation sequence

**What it tests**:
- ✅ Operations happen in the right order:
  1. `setContainers` (immediate UI update)
  2. `debouncedSaveThought` (background save)
  3. `updateStructure` (background structure update)
- ✅ No double UI updates (single `setContainers` call)
- ✅ Each operation happens exactly once

### Test 3: `should handle API errors gracefully with rollback and no visual jumping`
**Purpose**: Verifies error handling doesn't break UX

**What it tests**:
- ✅ Optimistic updates are applied immediately
- ✅ Failed API calls trigger proper rollback
- ✅ UI state is correctly restored on errors
- ✅ No visual jumping during error scenarios

## Critical Test Assertions

### Immediate State Updates
```typescript
expect(mockSetContainers).toHaveBeenCalledWith(
  expect.objectContaining({
    introduction: expect.arrayContaining([
      expect.objectContaining({
        id: 'thought-1',
        outlinePointId: 'intro-1' // THE FIX: Set immediately
      })
    ])
  })
);
```

### Debounced vs Direct API Calls
```typescript
// ✅ Should use debounced save
expect(mockDebouncedSaveThought).toHaveBeenCalledWith(/* ... */);

// ✅ Should NOT use direct update (preventing blocking)
expect(mockUpdateThought).not.toHaveBeenCalled();
```

### Operation Sequence
```typescript
expect(operationOrder).toEqual([
  'setContainers',        // 1. UI first
  'debouncedSaveThought', // 2. Background save
  'updateStructure'       // 3. Background structure
]);
```

## Why These Tests Matter

1. **Regression Prevention**: Ensures the visual jumping bug doesn't return
2. **Performance Validation**: Confirms non-blocking API architecture
3. **UX Quality**: Guarantees smooth drag & drop experience
4. **Error Resilience**: Validates proper rollback mechanisms

## Running the Tests

```bash
npm test -- --testPathPattern="structure-drag-drop-fix.test.tsx"
```

## Related Files

- `frontend/app/(pages)/structure/page.tsx` - Main implementation
- `frontend/__tests__/components/dnd-handlers.test.ts` - General drag & drop tests
- `frontend/app/utils/dnd-handlers.ts` - Extracted drag & drop utilities

## Future Considerations

These tests should be updated if:
- Drag & drop logic changes significantly
- New outline point assignment features are added
- API calling patterns change (e.g., different debouncing approach)
- New error scenarios need coverage 