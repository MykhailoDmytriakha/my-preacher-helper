import { fireEvent, render, screen } from '@testing-library/react';

import AddBlockButton from '@/components/groups/AddBlockButton';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    }),
}));

describe('AddBlockButton', () => {
    const onAdd = jest.fn();

    it('renders button with correct text', () => {
        render(<AddBlockButton onAdd={onAdd} />);
        expect(screen.getByText('Add block')).toBeInTheDocument();
    });

    it('opens menu and adds block', () => {
        render(<AddBlockButton onAdd={onAdd} />);

        const button = screen.getByText('Add block');
        fireEvent.click(button); // Open menu implementation details
        // The button has onClick on itself? Or wrapper?
        // <button ...>{t(...)}</button>.

        // Check if menu is open
        expect(screen.getByText('Main topic')).toBeInTheDocument();

        // Click an option
        fireEvent.click(screen.getByText('Main topic'));

        expect(onAdd).toHaveBeenCalledWith('topic');

        // Menu should close?
        // We can't easily check internal state 'open' without querying for absence of menu.
        expect(screen.queryByText('Main topic')).not.toBeInTheDocument();
    });

    it('closes menu on escape', () => {
        render(<AddBlockButton onAdd={onAdd} />);
        fireEvent.click(screen.getByText('Add block'));
        expect(screen.getByText('Main topic')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText('Main topic')).not.toBeInTheDocument();
    });
});
