import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FeatureCards from '@/components/landing/FeatureCards';

// Mock the i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'featureCards.recordingTitle': 'Powerful Recording',
        'featureCards.recordingDescription': 'Capture sermon thoughts effortlessly with our intuitive interface.',
        'featureCards.structuringTitle': 'Smart Structuring',
        'featureCards.structuringDescription': 'Organize your ideas into a cohesive sermon structure with AI assistance.',
        'featureCards.analysisTitle': 'Insightful Analysis',
        'featureCards.analysisDescription': 'Discover connections and themes in your material for deeper sermons.',
      };
      
      return translations[key] || key;
    },
  }),
}));

describe('FeatureCards Component', () => {
  it('renders all three feature cards', () => {
    render(<FeatureCards />);
    
    // Check if all three feature titles are displayed
    expect(screen.getByText('Powerful Recording')).toBeInTheDocument();
    expect(screen.getByText('Smart Structuring')).toBeInTheDocument();
    expect(screen.getByText('Insightful Analysis')).toBeInTheDocument();
  });
  
  it('displays all feature descriptions', () => {
    render(<FeatureCards />);
    
    // Check if all descriptions are displayed
    expect(screen.getByText('Capture sermon thoughts effortlessly with our intuitive interface.')).toBeInTheDocument();
    expect(screen.getByText('Organize your ideas into a cohesive sermon structure with AI assistance.')).toBeInTheDocument();
    expect(screen.getByText('Discover connections and themes in your material for deeper sermons.')).toBeInTheDocument();
  });
  
  it('renders three card containers with correct styling', () => {
    render(<FeatureCards />);
    
    // Check if we have three feature cards with expected class
    const cards = document.querySelectorAll('.p-8.border.rounded-xl');
    expect(cards).toHaveLength(3);
  });
  
  it('renders all emoji icons', () => {
    render(<FeatureCards />);
    
    // Find emoji containers
    const emojiContainers = document.querySelectorAll('.w-12.h-12.rounded-lg');
    expect(emojiContainers).toHaveLength(3);
    
    // Check if the emojis are present
    expect(emojiContainers[0].textContent).toContain('🎙️');
    expect(emojiContainers[1].textContent).toContain('✨');
    expect(emojiContainers[2].textContent).toContain('🔍');
  });
  
  it('uses gradient text for headings', () => {
    render(<FeatureCards />);
    
    // Check if headings have gradient text class
    const headings = document.querySelectorAll('.bg-gradient-to-r.bg-clip-text.text-transparent');
    expect(headings).toHaveLength(3);
  });
  
  it('renders in a responsive grid layout', () => {
    render(<FeatureCards />);
    
    // Check if the container has grid layout classes
    const gridContainer = document.querySelector('.grid.md\\:grid-cols-3');
    expect(gridContainer).toBeInTheDocument();
  });
}); 