import { execFileSync } from 'node:child_process';

const app = 'app/components/TranslationBoundaryProbe.tsx';
const fixtures = [
  { name: 'direct hook', filePath: app, code: "import { useTranslation } from 'react-i18next'; export const hook = useTranslation;", restricted: true },
  { name: 'aliased hook', filePath: app, code: "import { useTranslation as useLibrary } from 'react-i18next'; export const hook = useLibrary;", restricted: true },
  { name: 'namespace hook', filePath: app, code: "import * as library from 'react-i18next'; export const hook = library.useTranslation;", restricted: true },
  { name: 'default module hook', filePath: app, code: "import library from 'react-i18next'; export const hook = library.useTranslation;", restricted: true },
  { name: 'application hook', filePath: app, code: "import { useTranslation } from '@locales/useTranslation'; export const hook = useTranslation;", restricted: false },
  { name: 'library providers', filePath: app, code: "import { I18nextProvider, Trans } from 'react-i18next'; export const providers = [I18nextProvider, Trans];", restricted: false },
  { name: 'library types', filePath: app, code: "import type { UseTranslationResponse } from 'react-i18next'; export type Response = UseTranslationResponse<'translation'>;", restricted: false },
  { name: 'canonical adapter', filePath: 'locales/useTranslation.ts', code: "import { useTranslation as useLibrary } from 'react-i18next'; export const hook = useLibrary;", restricted: false },
  { name: 'library compatibility tests', filePath: '__tests__/locales/TranslationLibrary.test.tsx', code: "import { useTranslation } from 'react-i18next'; export const hook = useTranslation;", restricted: false },
];
let findings: Array<{ name: string; fatal: boolean; rules: string[] }>;

beforeAll(() => {
  const program = `
    import { loadESLint } from 'eslint';
    const ESLint = await loadESLint({ useFlatConfig: true });
    const lint = new ESLint({ cwd: process.cwd() });
    const fixtures = ${JSON.stringify(fixtures)};
    const findings = [];
    for (const fixture of fixtures) {
      const [result] = await lint.lintText(fixture.code, { filePath: fixture.filePath });
      findings.push({ name: fixture.name, fatal: result.messages.some(message => message.fatal),
        rules: result.messages.filter(message => message.ruleId === 'no-restricted-imports').map(message => message.ruleId) });
    }
    process.stdout.write(JSON.stringify(findings));
  `;
  findings = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-'], {
    cwd: process.cwd(), input: program, encoding: 'utf8', maxBuffer: 1024 * 1024,
  }));
});

it.each(fixtures)('enforces the translation boundary for $name', fixture => {
  const result = findings.find(row => row.name === fixture.name)!;
  expect(result.fatal).toBe(false);
  expect(result.rules).toHaveLength(fixture.restricted ? 1 : 0);
});
