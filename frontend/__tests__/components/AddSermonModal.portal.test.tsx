import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AddSermonModal from '@/components/AddSermonModal';
import { TestProviders } from '../../test-utils/test-providers';

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'addSermon.newSermon': 'New Sermon',
        'addSermon.titleLabel': 'Title',
        'addSermon.titlePlaceholder': 'Enter sermon title',
        'addSermon.verseLabel': 'Scripture Reference',
        'addSermon.versePlaceholder': 'Enter scripture reference',
        'addSermon.save': 'Save',
        'addSermon.cancel': 'Cancel',
      };
      return translations[key] || key;
    }
  })
}));

// Basic auth/router mocks
jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'test-user-id' } }
}));
jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn().mockResolvedValue({ id: '1', title: 't', verse: 'v', thoughts: [], userId: 'test-user-id', date: new Date().toISOString() })
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() })
}));

describe('AddSermonModal portal + centering (regression)', () => {
  test('renders into body portal and uses centered overlay classes', async () => {
    // Render inside a wrapper that could be transformed in app
    const wrapper = document.createElement('div');
    wrapper.setAttribute('id', 'transform-wrapper');
    document.body.appendChild(wrapper);

    render(
      <TestProviders>
        <AddSermonModal />
      </TestProviders>,
      { container: wrapper }
    );

    // Open the modal
    fireEvent.click(screen.getByText('New Sermon'));

    const portalContent = screen.getByTestId('portal-content');
    const heading = await screen.findByRole('heading', { name: 'New Sermon' });

    // Dialog content must render under portal content (body), not under wrapper
    expect(portalContent.contains(heading)).toBe(true);
    expect(wrapper.contains(heading)).toBe(false);

    // Overlay div must include fixed + centered flex classes
    const overlay = portalContent.querySelector('div');
    expect(overlay).toBeTruthy();
    const classList = (overlay as HTMLElement).className.split(' ');
    expect(classList).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'flex', 'items-center', 'justify-center']));
  });
});
