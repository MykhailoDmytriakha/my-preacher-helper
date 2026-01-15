import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";
import pluginImport from "eslint-plugin-import";
import pluginJestDom from "eslint-plugin-jest-dom";
import pluginSonarjs from "eslint-plugin-sonarjs";
import pluginTestingLibrary from "eslint-plugin-testing-library";
import pluginUnusedImports from "eslint-plugin-unused-imports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      "**/public/workbox-*.js",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: {
      import: pluginImport,
      "testing-library": pluginTestingLibrary,
      "jest-dom": pluginJestDom,
      sonarjs: pluginSonarjs,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "sonarjs/no-duplicate-string": ["warn", { threshold: 3 }],
      "sonarjs/cognitive-complexity": ["warn", 20],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: [
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/test-utils/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      "testing-library/await-async-queries": "error",
      "testing-library/no-wait-for-side-effects": "warn",
      "testing-library/prefer-screen-queries": "warn",
      "jest-dom/prefer-checked": "warn",
      "jest-dom/prefer-enabled-disabled": "warn",
      "import/order": "off",
      "no-var": "off",
      "react/no-children-prop": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "sonarjs/no-duplicate-string": "off",
      "react/display-name": "off",
    },
  },
  {
    files: ["tailwind.config.ts", "jest.config.ts", "jest.setup.js", "next.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    files: ["scripts/**/*.{js,ts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    files: ["jest.setup.js"],
    rules: {
      "react/no-children-prop": "off",
    },
  },
];

export default eslintConfig;
