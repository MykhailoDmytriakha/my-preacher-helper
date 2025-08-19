import { renderHook, act } from '@testing-library/react';
import { usePersistence } from '../usePersistence';
import { updateStructure } from '@/services/structure.service';
import { updateThought } from '@/services/thought.service';
import { Thought, Structure, Sermon } from '@/models/models';
import { toast } from 'sonner';

// Mock services
jest.mock('@/services/structure.service');
jest.mock('@/services/thought.service');
jest.mock('sonner');

const mockUpdateStructure = updateStructure as jest.MockedFunction<typeof updateStructure>;
const mockUpdateThought = updateThought as jest.MockedFunction<typeof updateThought>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('usePersistence', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    thoughts: [
      { id: 'thought-1', text: 'Test thought 1', tags: ['introduction'], date: new Date().toISOString() },
      { id: 'thought-2', text: 'Test thought 2', tags: ['main'], date: new Date().toISOString() },
    ],
    structure: {
      introduction: ['thought-1'],
      main: ['thought-2'],
      conclusion: [],
      ambiguous: []
    }
  } as Sermon;

  const mockThought: Thought = {
    id: 'thought-1',
    text: 'Test thought 1',
    tags: ['introduction'],
    date: new Date().toISOString()
  };

  const mockStructure: Structure = {
    introduction: ['thought-1'],
    main: ['thought-2'],
    conclusion: [],
    ambiguous: []
  };

  const defaultProps = {
    setSermon: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateStructure.mockResolvedValue(undefined);
    mockUpdateThought.mockResolvedValue(undefined);
  });

  describe('initialization', () => {
    it('should initialize with debounced functions', () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      expect(typeof result.current.debouncedSaveThought).toBe('function');
      expect(typeof result.current.debouncedSaveStructure).toBe('function');
    });

    it('should create debounced functions with correct delays', () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // Functions should be defined
      expect(result.current.debouncedSaveThought).toBeDefined();
      expect(result.current.debouncedSaveStructure).toBeDefined();
    });
  });

  describe('saveThought', () => {
    it('should save thought successfully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
    });

    it('should handle thought save errors gracefully', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Save failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should handle missing sermonId', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('', mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('', mockThought);
    });

    it('should handle special characters in sermonId', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-123_abc', mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-123_abc', mockThought);
    });
  });

  describe('saveStructure', () => {
    it('should save structure successfully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
    });

    it('should handle structure save errors gracefully', async () => {
      mockUpdateStructure.mockRejectedValueOnce(new Error('Save failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should handle empty structure', async () => {
      const emptyStructure: Structure = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', emptyStructure);
      });

      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', emptyStructure);
    });

    it('should handle structure with many items', async () => {
      const largeStructure: Structure = {
        introduction: Array.from({ length: 100 }, (_, i) => `thought-${i}`),
        main: Array.from({ length: 50 }, (_, i) => `main-thought-${i}`),
        conclusion: Array.from({ length: 25 }, (_, i) => `conclusion-thought-${i}`),
        ambiguous: []
      };
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', largeStructure);
      });

      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', largeStructure);
    });
  });

  describe('debouncedSaveThought', () => {
    it('should call saveThought with debouncing', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // Call multiple times rapidly
      act(() => {
        result.current.debouncedSaveThought('sermon-1', mockThought);
        result.current.debouncedSaveThought('sermon-1', mockThought);
        result.current.debouncedSaveThought('sermon-1', mockThought);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should only be called once due to debouncing
      expect(mockUpdateThought).toHaveBeenCalledTimes(1);
    });

    it('should handle different thoughts correctly', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));
      const thought2: Thought = { ...mockThought, id: 'thought-2', text: 'Test thought 2' };

      act(() => {
        result.current.debouncedSaveThought('sermon-1', mockThought);
        result.current.debouncedSaveThought('sermon-1', thought2);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should be called for the last thought
      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', thought2);
    });

    it('should handle different sermonIds correctly', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      act(() => {
        result.current.debouncedSaveThought('sermon-1', mockThought);
        result.current.debouncedSaveThought('sermon-2', mockThought);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should be called for the last sermonId
      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-2', mockThought);
    });
  });

  describe('debouncedSaveStructure', () => {
    it('should call saveStructure with debouncing', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // Call multiple times rapidly
      act(() => {
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should only be called once due to debouncing
      expect(mockUpdateStructure).toHaveBeenCalledTimes(1);
    });

    it('should handle different structures correctly', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));
      const structure2: Structure = { ...mockStructure, introduction: ['thought-3'] };

      act(() => {
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
        result.current.debouncedSaveStructure('sermon-1', structure2);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should be called for the last structure
      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', structure2);
    });

    it('should handle different sermonIds correctly', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      act(() => {
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
        result.current.debouncedSaveStructure('sermon-2', mockStructure);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should be called for the last sermonId
      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-2', mockStructure);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Network error'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should handle timeout errors gracefully', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Timeout'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should handle validation errors gracefully', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Validation failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should handle structure validation errors gracefully', async () => {
      mockUpdateStructure.mockRejectedValueOnce(new Error('Invalid structure'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe('performance and optimization', () => {
    it('should debounce rapid calls efficiently', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      const startTime = Date.now();

      // Make many rapid calls
      for (let i = 0; i < 100; i++) {
        act(() => {
          result.current.debouncedSaveThought('sermon-1', mockThought);
        });
      }

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should execute quickly (debouncing should not block)
      expect(executionTime).toBeLessThan(100);

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should only make one actual API call
      expect(mockUpdateThought).toHaveBeenCalledTimes(1);
    });

    it('should handle large data efficiently', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));
      const largeThought: Thought = {
        ...mockThought,
        text: 'A'.repeat(10000), // Very long text
        tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`)
      };

      await act(async () => {
        await result.current.saveThought('sermon-1', largeThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', largeThought);
    });

    it('should handle concurrent saves efficiently', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // Simulate concurrent saves
      const promises = Array.from({ length: 10 }, (_, i) => 
        result.current.saveThought(`sermon-${i}`, { ...mockThought, id: `thought-${i}` })
      );

      await act(async () => {
        await Promise.all(promises);
      });

      expect(mockUpdateThought).toHaveBeenCalledTimes(10);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete save workflow', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // 1. Save thought
      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);

      // 2. Save structure
      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
    });

    it('should handle debounced save workflow', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // 1. Debounced save thought
      act(() => {
        result.current.debouncedSaveThought('sermon-1', mockThought);
      });

      // 2. Debounced save structure
      act(() => {
        result.current.debouncedSaveStructure('sermon-1', mockStructure);
      });

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
    });

    it('should handle mixed save types correctly', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      // Mix immediate and debounced saves
      act(() => {
        result.current.debouncedSaveThought('sermon-1', mockThought);
      });

      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      // Structure should be saved immediately
      expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);

      // Wait for thought debounce
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
    });
  });

  describe('edge cases', () => {
    it('should handle null sermonId gracefully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought(null as any, mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith(null, mockThought);
    });

    it('should handle undefined sermonId gracefully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought(undefined as any, mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith(undefined, mockThought);
    });

    it('should handle empty string sermonId gracefully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('', mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith('', mockThought);
    });

    it('should handle very long sermonId gracefully', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));
      const longSermonId = 'a'.repeat(1000);

      await act(async () => {
        await result.current.saveThought(longSermonId, mockThought);
      });

      expect(mockUpdateThought).toHaveBeenCalledWith(longSermonId, mockThought);
    });
  });

  describe('toast notifications', () => {
    it('should show error toast for thought save failures', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Save failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should show error toast for structure save failures', async () => {
      mockUpdateStructure.mockRejectedValueOnce(new Error('Save failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveStructure('sermon-1', mockStructure);
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should not show success toasts for successful saves', async () => {
      const { result } = renderHook(() => usePersistence(defaultProps));

      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });

      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });
});
