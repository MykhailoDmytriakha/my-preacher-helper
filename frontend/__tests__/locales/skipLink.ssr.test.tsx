import React from 'react';

import { SkipLink } from '@/components/navigation/SkipLink';

const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server');

jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

it('translates the server skip link when it is the first translation consumer', () => {
  expect(renderToString(<SkipLink />)).toContain('>Skip to main content</a>');
});
