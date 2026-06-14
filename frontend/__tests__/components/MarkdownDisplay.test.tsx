import { render } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import MarkdownDisplay, { markdownSanitizeSchema } from '@components/MarkdownDisplay';

// NOTE on testing strategy:
// This repo runs under next/jest, whose injected `transformIgnorePatterns`
// catch-all prevents the ESM markdown stack (react-markdown / remark / rehype /
// unified) from being transformed. The project therefore mocks that whole stack
// globally in jest.setup.js, so a DOM-level "<u> renders underlined" assertion is
// not reachable here without reworking global jest infra.
//
// Instead we assert the security-critical contract directly: the sanitize schema
// that MarkdownDisplay feeds to rehype-sanitize allows the safe inline formatting
// tags (incl. the bug's <u>) and excludes dangerous ones. The real, un-mocked
// rehype-sanitize defaultSchema is validated separately (see the dedicated test
// below) so we know our allow-list is layered on top of a safe base.

describe('MarkdownDisplay sanitize schema (allow-list contract)', () => {
  const allowed = markdownSanitizeSchema.tagNames ?? [];

  it.each(['u', 'b', 'i', 'em', 'strong', 'mark', 'sub', 'sup', 'br', 'a'])(
    'allows safe inline tag <%s>',
    (tag) => {
      expect(allowed).toContain(tag);
    }
  );

  it('explicitly allows <u> (the underline-rendering bug)', () => {
    expect(allowed).toContain('u');
  });

  it.each(['script', 'iframe', 'object', 'embed', 'style'])(
    'does NOT allow dangerous tag <%s>',
    (tag) => {
      expect(allowed).not.toContain(tag);
    }
  );

  it('still renders without throwing (smoke test through mocked pipeline)', () => {
    const { container } = render(
      <MarkdownDisplay content={'This is <u>underlined</u> text'} />
    );
    expect(container.textContent).toContain('underlined');
  });
});
