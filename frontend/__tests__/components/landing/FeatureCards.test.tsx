import { render, screen } from '@testing-library/react';
import React from 'react';

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
        'featureCards.handOffTitle': 'Smooth Handoff',
        'featureCards.handOffDescription': 'Share and switch perspectives without losing context.',
        'featureCards.handOffBadge': 'Handoff',
        'landing.valueCapture': 'Capture',
        'landing.valueStructure': 'Structure',
        'landing.valueDeliver': 'Deliver',
      };
      
      return translations[key] || key;
    },
  }),
}));

describe('FeatureCards Component', () => {
  it('renders all feature cards', () => {
    render(<FeatureCards />);
    
    // Check if all four feature titles are displayed
    expect(screen.getByText('Powerful Recording')).toBeInTheDocument();
    expect(screen.getByText('Smart Structuring')).toBeInTheDocument();
    expect(screen.getByText('Insightful Analysis')).toBeInTheDocument();
    expect(screen.getByText('Smooth Handoff')).toBeInTheDocument();
  });
  
  it('displays all feature descriptions', () => {
    render(<FeatureCards />);
    
    // Check if all descriptions are displayed
    expect(screen.getByText('Capture sermon thoughts effortlessly with our intuitive interface.')).toBeInTheDocument();
    expect(screen.getByText('Organize your ideas into a cohesive sermon structure with AI assistance.')).toBeInTheDocument();
    expect(screen.getByText('Discover connections and themes in your material for deeper sermons.')).toBeInTheDocument();
    expect(screen.getByText('Share and switch perspectives without losing context.')).toBeInTheDocument();
  });
  
  it('renders card containers with correct styling', () => {
    render(<FeatureCards />);
    
    const cards = document.querySelectorAll('.rounded-2xl.border');
    expect(cards).toHaveLength(4);
  });
  
  it('renders all icon containers', () => {
    render(<FeatureCards />);
    
    const iconContainers = document.querySelectorAll('.h-11.w-11.rounded-xl');
    expect(iconContainers).toHaveLength(4);
  });
  
  it('renders in a responsive grid layout', () => {
    render(<FeatureCards />);
    
    // Check if the container has grid layout classes
    const gridContainer = document.querySelector('.grid.md\\:grid-cols-2');
    expect(gridContainer).toBeInTheDocument();
  });
}); 