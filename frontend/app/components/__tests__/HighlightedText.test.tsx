import React from 'react';
import { render, screen } from '@testing-library/react';
import HighlightedText from '../HighlightedText';

// Mock the themeColors constant to avoid import issues
jest.mock('@/utils/themeColors', () => ({
    HIGHLIGHT_COLORS: {
        bg: 'bg-yellow-200',
        darkBg: 'dark:bg-yellow-900',
        text: 'text-black',
        ring: 'ring-yellow-500',
        weight: 'font-medium',
    }
}));

describe('HighlightedText', () => {
    it('renders plain text when no query provided', () => {
        render(<HighlightedText text="Hello World" searchQuery="" />);
        expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('highlights simple matches', () => {
        const { container } = render(<HighlightedText text="Hello World" searchQuery="World" />);
        const mark = container.querySelector('mark');
        expect(mark).toBeInTheDocument();
        expect(mark).toHaveTextContent('World');
        expect(container).toHaveTextContent('Hello World');
    });

    it('highlights case-insensitive matches', () => {
        const { container } = render(<HighlightedText text="Hello world" searchQuery="WORLD" />);
        const mark = container.querySelector('mark');
        expect(mark).toHaveTextContent('world');
    });

    it('highlights multiple occurrences', () => {
        const { container } = render(<HighlightedText text="test TEST test" searchQuery="test" />);
        const marks = container.querySelectorAll('mark');
        expect(marks).toHaveLength(3);
        expect(marks[0]).toHaveTextContent('test');
        expect(marks[1]).toHaveTextContent('TEST');
        expect(marks[2]).toHaveTextContent('test');
    });

    it('handles regex special characters in query', () => {
        // Query has a dot (special char), text has a dot.
        const { container } = render(<HighlightedText text="Version 1.0 released" searchQuery="1.0" />);
        const mark = container.querySelector('mark');
        expect(mark).toHaveTextContent('1.0');
    });
});
