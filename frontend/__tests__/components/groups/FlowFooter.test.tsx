import { render, screen } from '@testing-library/react';

import FlowFooter from '@/components/groups/FlowFooter';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    }),
}));

describe('FlowFooter', () => {
    it('renders nothing when total count is 0', () => {
        const { container } = render(<FlowFooter totalCount={0} totalDuration={0} filledCount={0} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders stats correctly', () => {
        render(<FlowFooter totalCount={5} totalDuration={45} filledCount={2} />);
        expect(screen.getByText(/~45/)).toBeInTheDocument();
        expect(screen.getByText(/2\/5/)).toBeInTheDocument();
        // Check progress bar functionality if possible?
        /* 
           Progress bar is visual. 
           2/5 = 40%.
           style={{ width: '40%' }}
        */
        // We can find by class or verify text presence.
        expect(screen.getByText(/min/)).toBeInTheDocument();
        expect(screen.getByText(/filled/)).toBeInTheDocument();
    });
});
