# Import Path Standards

## Overview

This document outlines the standardized approach for imports throughout the My Preacher Helper application. Consistent import patterns make the codebase more maintainable, readable, and less prone to path-related errors.

## Path Aliases

The project uses TypeScript path aliases to avoid complex relative paths. These are defined in `tsconfig.json`:

```json
"paths": {
  "@/*": ["./app/*"],
  "@components/*": ["./app/components/*"],
  "@services/*": ["./app/services/*"],
  "@api/*": ["./app/api/*"],
  "@clients/*": ["./app/api/clients/*"],
  "@repositories/*": ["./app/api/repositories/*"],
  "@utils/*": ["./app/utils/*"],
  "@locales/*": ["./locales/*"]
}
```

## Import Standards

### 1. Use Path Aliases Instead of Relative Paths

**DO:**
```typescript
import { ChevronIcon } from '@components/Icons';
import { getSermonById } from '@/services/sermon.service';
```

**DON'T:**
```typescript
import { ChevronIcon } from '../../components/Icons';
import { getSermonById } from '../services/sermon.service';
```

### 2. Import Order

Follow this order for imports:
1. External libraries
2. React/Next.js imports
3. Path alias imports (ordered by alias)
4. Relative path imports (if absolutely necessary)

**Example:**
```typescript
// External libraries
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// Path alias imports (ordered by alias)
import type { Sermon } from '@/models/models';
import { ChevronIcon, RefreshIcon } from '@components/Icons';
import { getSermonById } from '@/services/sermon.service';
import { formatDate } from '@/utils/dateFormatter';

// Local imports (if applicable)
import './styles.css';
```

### 3. Use Specific Import Aliases

Use the most specific path alias available:

**DO:**
```typescript
import { ChevronIcon } from '@components/Icons';
import { formatDate } from '@/utils/dateFormatter';
```

**DON'T:**
```typescript
import { ChevronIcon } from '@/components/Icons';  // Use @components instead
```

### 4. Named vs Default Exports

Prefer named exports over default exports for better refactorability:

**DO:**
```typescript
// In file: Icons.tsx
export const ChevronIcon = () => { /* ... */ };

// In importing file:
import { ChevronIcon } from '@components/Icons';
```

**AVOID WHEN POSSIBLE:**
```typescript
// In file: Icons.tsx
const ChevronIcon = () => { /* ... */ };
export default ChevronIcon;

// In importing file:
import ChevronIcon from '@components/Icons';
```

## Tools for Import Standardization

### Import Analysis Script

The project includes a script to identify non-standard import patterns:

```bash
node frontend/scripts/standardize-imports.js
```

This will show files that should be updated to use path aliases instead of relative paths.

### ESLint Rules (Recommended)

Consider adding ESLint rules to enforce import standards:

```json
{
  "rules": {
    "import/no-relative-parent-imports": "error",
    "import/order": [
      "error",
      {
        "groups": [
          "builtin",
          "external",
          "internal",
          ["sibling", "parent"],
          "index",
          "unknown"
        ],
        "newlines-between": "always",
        "alphabetize": {
          "order": "asc",
          "caseInsensitive": true
        }
      }
    ]
  }
}
```

## Benefits of Standardized Imports

- **Improved readability**: Consistent patterns make code easier to understand
- **Better maintainability**: Changes to file structure have less impact on imports
- **Reduced errors**: Fewer complex relative paths means fewer path-related bugs
- **Easier refactoring**: Moving files requires fewer import updates
- **Simplified code review**: Standardized patterns are easier to review

## Migration Strategy

1. Use the `standardize-imports.js` script to identify files needing updates
2. Prioritize updating components in heavily modified areas first
3. Consider batch updates for similar file types
4. Add the recommended ESLint rules to prevent new non-standard imports 