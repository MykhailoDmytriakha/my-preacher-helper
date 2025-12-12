import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

import { getFocusModeUrl } from '@/utils/urlUtils'

import { FocusNav } from '../FocusNav'


jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('@/utils/urlUtils', () => ({
  getFocusModeUrl: jest.fn(),
}))

const mockGetFocusModeUrl = getFocusModeUrl as jest.MockedFunction<typeof getFocusModeUrl>
const buildStructurePath = (sermonId: string) => `/sermons/${sermonId}/structure`
const buildFocusUrl = (section: string, sermonId: string) => `${buildStructurePath(sermonId)}?mode=focus&section=${section}`

describe('FocusNav', () => {
  const defaultProps = {
    sermon: { id: 'sermon-1', title: 'Test Sermon' },
    sermonId: 'sermon-1',
    focusedColumn: null as string | null,
    onToggleFocusMode: jest.fn(),
    onNavigateToSection: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFocusModeUrl.mockImplementation((section, sermonId) => buildFocusUrl(section, sermonId))
  })

  const renderNav = (overrideProps = {}) => render(<FocusNav {...defaultProps} {...overrideProps} />)

  it('renders back link in normal mode and section buttons in focus mode', () => {
    renderNav()
    const backLink = screen.getByText('structure.backToSermon').closest('a')
    expect(backLink).toHaveAttribute('href', '/sermons/sermon-1')

    cleanup()

    renderNav({ focusedColumn: 'introduction' })
    expect(screen.getByText('structure.introduction')).toBeInTheDocument()
    expect(screen.getByText('structure.mainPart')).toBeInTheDocument()
    expect(screen.getByText('structure.conclusion')).toBeInTheDocument()
  })

  it('generates focus URLs and navigates between sections', () => {
    renderNav()
    expect(mockGetFocusModeUrl).toHaveBeenCalledWith('introduction', 'sermon-1')
    expect(mockGetFocusModeUrl).toHaveBeenCalledWith('main', 'sermon-1')
    expect(mockGetFocusModeUrl).toHaveBeenCalledWith('conclusion', 'sermon-1')

    cleanup()

    const onNavigate = jest.fn()
    renderNav({ focusedColumn: 'main', onNavigateToSection: onNavigate })
    fireEvent.click(screen.getByText('structure.mainPart'))
    expect(onNavigate).toHaveBeenCalledWith('main')
  })

  it('toggles focus mode and handles various sermonId shapes', () => {
    const onToggle = jest.fn()
    renderNav({ focusedColumn: 'conclusion', onToggleFocusMode: onToggle })
    fireEvent.click(screen.getByText('structure.normalMode'))
    expect(onToggle).toHaveBeenCalledWith('conclusion')

    cleanup()
    mockGetFocusModeUrl.mockClear()
    renderNav({ sermonId: 'sermon-123_abc' })
    expect(mockGetFocusModeUrl).toHaveBeenCalledWith('introduction', 'sermon-123_abc')

    cleanup()
    mockGetFocusModeUrl.mockClear()
    renderNav({ sermonId: '', focusedColumn: null })
    expect(mockGetFocusModeUrl).not.toHaveBeenCalled()
  })

  it('exposes accessibility attributes and button semantics', () => {
    renderNav({ focusedColumn: 'introduction' })
    const introButton = screen.getByText('structure.introduction')
    expect(introButton.tagName).toBe('BUTTON')
    expect(screen.getByText('structure.mainPart').tagName).toBe('BUTTON')
    expect(screen.getByText('structure.conclusion').tagName).toBe('BUTTON')
    // Normal mode button doesn't have explicit type, defaults to submit
  })

  it('handles rapid interactions and does not throw on missing props', () => {
    const onNavigate = jest.fn()
    const onToggle = jest.fn()
    renderNav({ focusedColumn: 'introduction', onNavigateToSection: onNavigate, onToggleFocusMode: onToggle })
    const introButton = screen.getByText('structure.introduction')
    fireEvent.click(introButton)
    fireEvent.click(introButton)
    fireEvent.click(introButton)
    expect(onNavigate).toHaveBeenCalledTimes(3)

    const normalModeButton = screen.getByText('structure.normalMode')
    fireEvent.click(normalModeButton)
    expect(onToggle).toHaveBeenCalled()

    expect(() => renderNav({ sermonId: null as any })).not.toThrow()
  })
})
