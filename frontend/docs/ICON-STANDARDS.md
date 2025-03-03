# Icon Standardization Guide

## Overview

This document outlines the standardized approach to using icons throughout the My Preacher Helper application. The goal is to ensure consistent styling, behavior, and implementation of icons across all components.

## Icon Component System

All icons should be implemented as reusable components in `frontend/app/components/Icons.tsx`. This centralized approach offers several benefits:

- **Consistency**: All icons follow the same implementation pattern
- **Maintainability**: Changes to icons can be made in one place
- **Performance**: Reduces duplication of SVG code throughout the application
- **Accessibility**: Ensures consistent accessibility attributes

## Available Icons

The following standardized icons are available:

- `GoogleIcon` - Google logo for authentication
- `MicrophoneIcon` - Microphone for audio recording
- `PlusIcon` - Plus sign for adding items
- `ChevronIcon` - Directional chevron with support for all directions
- `UserIcon` - User profile icon
- `DotsVerticalIcon` - Vertical dots for menus
- `TrashIcon` - Trash can for deletion actions
- `EditIcon` - Pencil for editing actions
- `RefreshIcon` - Refresh/reload indicator
- `DocumentIcon` - Document/page representation

## How to Use

### Basic Usage

```tsx
import { ChevronIcon } from '@/app/components/Icons';

// In your component
<ChevronIcon className="text-gray-500" />
```

### With Direction (ChevronIcon)

The ChevronIcon supports different directions via the `direction` prop:

```tsx
<ChevronIcon direction="up" className="text-gray-500" />
<ChevronIcon direction="down" className="text-gray-500" />
<ChevronIcon direction="left" className="text-gray-500" />
<ChevronIcon direction="right" className="text-gray-500" />
```

### With Animation

For expandable/collapsible elements, use a rotation transform:

```tsx
<ChevronIcon className={expanded ? 'rotate-180' : ''} />
```

## Icon Size and Color Standards

- Default size: `w-5 h-5`
- For smaller contexts: `w-4 h-4` 
- Colors should use Tailwind classes:
  - Default: `text-gray-500 dark:text-gray-400`
  - Hover: `hover:text-gray-700 dark:hover:text-gray-200`
  - Active/Selected: Text color of the current theme (blue, purple, etc.)

## Adding New Icons

When adding new icons to the system:

1. Add the icon component to `Icons.tsx`
2. Use the standard IconProps interface
3. Follow the same pattern as existing icons
4. Use clear, descriptive names
5. Include comments above the component

## Migration Guide

When migrating inline SVGs to the standardized system:

1. Import the appropriate icon from Icons.tsx
2. Replace the inline SVG with the imported component
3. Transfer any className styles
4. Adjust sizing if needed to match the application standard

## Best Practices

- Never include inline SVG code in components
- Use semantic naming for icons that reflects their purpose
- Maintain consistent sizing and coloring throughout the application
- For interactive icons, ensure proper accessibility attributes are used 