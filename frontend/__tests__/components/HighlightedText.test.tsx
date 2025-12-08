import { render, screen } from '@testing-library/react';
import HighlightedText from '@/components/HighlightedText';
import { HIGHLIGHT_COLORS } from '@/utils/themeColors';

describe('HighlightedText', () => {
    it('renders text without highlight when query is empty', () => {
        render(<HighlightedText text="Hello World" searchQuery="" />);
        expect(screen.getByText('Hello World')).toBeInTheDocument();
        expect(screen.queryByRole('mark')).not.toBeInTheDocument();
    });

    it('renders text without highlight when query has only spaces', () => {
        render(<HighlightedText text="Hello World" searchQuery="   " />);
        expect(screen.getByText('Hello World')).toBeInTheDocument();
        expect(screen.queryByRole('mark')).not.toBeInTheDocument();
    });

    it('highlights single occurrence of query', () => {
        render(<HighlightedText text="Hello World" searchQuery="World" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('World');
        expect(mark).toHaveClass(HIGHLIGHT_COLORS.bg);
        expect(mark).toHaveClass(HIGHLIGHT_COLORS.text);
    });

    it('highlights multiple occurrences of query', () => {
        render(<HighlightedText text="The Bible teaches us about the Bible" searchQuery="Bible" />);
        const marks = screen.getAllByRole('mark');
        expect(marks).toHaveLength(2);
        marks.forEach((mark) => {
            expect(mark).toHaveTextContent('Bible');
        });
    });

    it('performs case-insensitive matching', () => {
        render(<HighlightedText text="The BIBLE teaches us about the Bible" searchQuery="bible" />);
        const marks = screen.getAllByRole('mark');
        expect(marks).toHaveLength(2);
        expect(marks[0]).toHaveTextContent('BIBLE');
        expect(marks[1]).toHaveTextContent('Bible');
    });

    it('handles special regex characters in query', () => {
        render(<HighlightedText text="Use (parentheses) for grouping" searchQuery="(parentheses)" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('(parentheses)');
    });

    it('handles query with asterisks', () => {
        render(<HighlightedText text="Important * text * here" searchQuery="*" />);
        const marks = screen.getAllByRole('mark');
        expect(marks).toHaveLength(2);
    });

    it('handles query with question marks', () => {
        render(<HighlightedText text="What? Really?" searchQuery="?" />);
        const marks = screen.getAllByRole('mark');
        expect(marks).toHaveLength(2);
    });

    it('applies custom highlight class', () => {
        render(
            <HighlightedText
                text="Hello World"
                searchQuery="World"
                highlightClassName="bg-green-300"
            />
        );
        const mark = screen.getByRole('mark');
        expect(mark).toHaveClass('bg-green-300');
    });

    it('renders empty string gracefully', () => {
        const { container } = render(<HighlightedText text="" searchQuery="test" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('handles query longer than text', () => {
        render(<HighlightedText text="Hi" searchQuery="Hello World" />);
        expect(screen.getByText('Hi')).toBeInTheDocument();
        expect(screen.queryByRole('mark')).not.toBeInTheDocument();
    });

    it('highlights query at start of text', () => {
        render(<HighlightedText text="Bible is great" searchQuery="Bible" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('Bible');
    });

    it('highlights query at end of text', () => {
        render(<HighlightedText text="Read the Bible" searchQuery="Bible" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('Bible');
    });

    it('highlights each word in a multi-word query regardless of order', () => {
        render(<HighlightedText text="Жертва Адама" searchQuery="адама жертва" />);
        const marks = screen.getAllByRole('mark');
        expect(marks).toHaveLength(2);
        expect(marks[0]).toHaveTextContent(/жертва/i);
        expect(marks[1]).toHaveTextContent(/адама/i);
    });

    it('handles Cyrillic text', () => {
        render(<HighlightedText text="Библия - это слово Божье" searchQuery="Библия" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('Библия');
    });

    it('handles Ukrainian text', () => {
        render(<HighlightedText text="Біблія є Слово Боже" searchQuery="Біблія" />);
        const mark = screen.getByRole('mark');
        expect(mark).toHaveTextContent('Біблія');
    });
});
