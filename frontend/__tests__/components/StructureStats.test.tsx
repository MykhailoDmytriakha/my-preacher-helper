import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

import '@testing-library/jest-dom'
import StructureStats from '../../app/components/sermon/StructureStats'
import { Sermon } from '../../app/models/models'

// Mock next/navigation
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        'structure.title': 'Sermon ThoughtsBySection',
        'structure.entries': 'entries',
        'structure.recommended': `Recommended: ${options?.percent || 0}%`,
        'structure.workButton': 'Work on ThoughtsBySection',
        'structure.focusMode': 'Focus Mode',
        'structure.inconsistentTagsWarning': 'Some thoughts have tag inconsistencies. Please fix them before working on structure.',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
        'plan.pageTitle': 'Plan',
        plan: 'Plan',
      }
      return translations[key] || key
    },
  }),
}))

// Mock theme colors and helpers
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: { base: '#d97706' },
    mainPart: { base: '#2563eb' },
    conclusion: { base: '#16a34a' },
  },
  UI_COLORS: {
    button: {
      structure: {
        bg: 'bg-amber-600',
        hover: 'hover:bg-amber-700',
        darkBg: 'bg-amber-500',
        darkHover: 'hover:bg-amber-400',
        text: 'text-white',
      },
      plan: {
        bg: 'bg-blue-600',
        hover: 'hover:bg-blue-700',
        darkBg: 'bg-blue-500',
        darkHover: 'hover:bg-blue-400',
        text: 'text-white',
      },
      switcher: {
        gradient: 'from-violet-600 to-fuchsia-600',
        darkGradient: 'from-violet-500 to-fuchsia-500',
        border: 'border-gray-200',
        darkBorder: 'border-gray-700',
        bg: 'bg-white',
        darkBg: 'bg-gray-800',
        activeText: 'text-white',
        inactiveText: 'text-gray-700',
        darkInactiveText: 'text-gray-200',
      },
    },
  },
  getFocusModeButtonColors: (section: string) => {
    const colors = {
      introduction: { bg: 'bg-amber-500', hover: 'hover:bg-amber-600', text: 'text-white' },
      mainPart: { bg: 'bg-blue-500', hover: 'hover:bg-blue-600', text: 'text-white' },
      conclusion: { bg: 'bg-green-500', hover: 'hover:bg-green-600', text: 'text-white' },
    }
    return colors[section as keyof typeof colors] || colors.introduction
  },
}))

jest.mock('@/utils/urlUtils', () => ({
  getFocusModeUrl: (section: string, sermonId: string) => `/sermons/${sermonId}/structure?mode=focus&section=${section}`,
}))

describe('StructureStats Component', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  const mockSermon: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user1',
    structure: {
      introduction: [],
      main: [],
      conclusion: [],
      ambiguous: [],
    },
  }

  const mockTagCounts = {
    'Вступление': 1,
    'Основная часть': 1,
    'Заключение': 1,
  }

  const totalThoughts = 3

  const renderStats = (overrideProps: Partial<React.ComponentProps<typeof StructureStats>> = {}) =>
    render(<StructureStats sermon={mockSermon} tagCounts={mockTagCounts} totalThoughts={totalThoughts} {...overrideProps} />)

  it('renders structure overview with percentages and focus buttons', () => {
    renderStats()
    expect(screen.getByText('Sermon ThoughtsBySection')).toBeInTheDocument()
    expect(screen.getAllByText('33%')).toHaveLength(3)
    expect(screen.getAllByText(/Recommended: 20%/)).toHaveLength(2)
    expect(screen.getAllByText(/Recommended: 60%/)).toHaveLength(1)

    const sections = ['introduction', 'main', 'conclusion']
    const focusButtons = screen.getAllByText('Focus Mode')
    expect(focusButtons).toHaveLength(3)
    focusButtons.forEach((button, index) => {
      expect(button.closest('a')).toHaveAttribute('href', `/sermons/${mockSermon.id}/structure?mode=focus&section=${sections[index]}`)
    })
  })

  it('handles navigation buttons and inconsistency gating rules', () => {
    renderStats()
    fireEvent.click(screen.getByText('Work on ThoughtsBySection'))
    expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/structure`)
    fireEvent.click(screen.getByText('Plan'))
    expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan`)

    mockPush.mockClear()
    cleanup()
    renderStats({ hasInconsistentThoughts: true })
    fireEvent.click(screen.getByText('Work on ThoughtsBySection'))
    expect(mockPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Plan'))
    expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan`)
    const structureButton = screen.getByText('Work on ThoughtsBySection')
    expect(structureButton).toHaveAttribute('title', 'Some thoughts have tag inconsistencies. Please fix them before working on structure.')
  })

  it('applies gradient/toggle styling and responsive layout', () => {
    const { rerender } = renderStats({ hasInconsistentThoughts: true })
    const toggle = document.querySelector('.relative.inline-flex.items-center.rounded-full.border')
    const gradient = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600') as HTMLElement
    expect(toggle).toHaveClass('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'w-full')
    expect(toggle).toHaveClass('transition-shadow', 'duration-200')
    expect(gradient).toHaveClass('transition-all', 'duration-300', 'ease-in-out')
    expect(gradient).toHaveStyle({ opacity: '0.3' })

    rerender(
      <StructureStats
        sermon={mockSermon}
        tagCounts={mockTagCounts}
        totalThoughts={totalThoughts}
        hasInconsistentThoughts={false}
      />,
    )
    expect(document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600')).toHaveStyle({ opacity: '1' })
  })

  it('renders plan toggle buttons with hover, active, and disabled styling', () => {
    renderStats({ hasInconsistentThoughts: true })
    const structureButton = screen.getByText('Work on ThoughtsBySection')
    const planButton = screen.getByText('Plan')

    ;[structureButton, planButton].forEach((button) => {
      expect(button).toHaveClass('relative', 'z-10', 'px-4', 'py-2', 'text-sm', 'font-medium')
      expect(button).toHaveClass('transition-all', 'duration-200', 'ease-in-out')
      if (!button.disabled) {
        expect(button).toHaveClass('hover:scale-105', 'hover:shadow-lg', 'active:scale-95')
      }
    })

    expect(structureButton).toBeDisabled()
    expect(structureButton).toHaveClass('text-gray-400', 'cursor-not-allowed')
    expect(planButton).toBeEnabled()
  })

  it('maintains accessibility, translations, and layout helpers', () => {
    renderStats()
    expect(screen.getByText('Work on ThoughtsBySection')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    // Note: 'entries' appears in tooltips, not as visible text in this component
    const separator = document.querySelector('.w-0\\.5.h-6.bg-white\\/90.dark\\:bg-white\\/70')
    expect(separator).toBeInTheDocument()
  })
})
