import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';

import { Thought, ThoughtsBySection } from '@/models/models';
import { updateStructure } from '@/services/structure.service';
import { updateThought } from '@/services/thought.service';
import { runScenarios } from '@test-utils/scenarioRunner';

import { usePersistence } from '../usePersistence';

// Mock services
jest.mock('@/services/structure.service');
jest.mock('@/services/thought.service');
jest.mock('sonner');

const mockUpdateStructure = updateStructure as jest.MockedFunction<typeof updateStructure>;
const mockUpdateThought = updateThought as jest.MockedFunction<typeof updateThought>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('usePersistence', () => {
  // Use fake timers to control debounce-based timing deterministically
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const flushDebounce = async (ms = 500) => {
    // Advance timers to trigger lodash.debounce and then flush microtasks
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  };

  const mockThought: Thought = {
    id: 'thought-1',
    text: 'Test thought 1',
    tags: ['introduction'],
    date: new Date().toISOString()
  };

  const mockStructure: ThoughtsBySection = {
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
    it('wires up debounced functions without redundant tests', async () => {
      await runScenarios([
        {
          name: 'function presence',
          run: () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            expect(typeof result.current.debouncedSaveThought).toBe('function');
            expect(typeof result.current.debouncedSaveStructure).toBe('function');
          },
        },
        {
          name: 'function definitions',
          run: () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            expect(result.current.debouncedSaveThought).toBeDefined();
            expect(result.current.debouncedSaveStructure).toBeDefined();
          },
        },
      ]);
    });
  });

  describe('saveThought', () => {
    it('covers success, failures, and id edge cases together', async () => {
      await runScenarios([
        {
          name: 'successful save',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveThought('sermon-1', mockThought);
            });
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
          },
        },
        {
          name: 'error surfaces toast',
          run: async () => {
            mockUpdateThought.mockRejectedValueOnce(new Error('Save failed'));
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveThought('sermon-1', mockThought);
            });
            expect(mockToast.error).toHaveBeenCalled();
          },
        },
        {
          name: 'handles unusual sermonIds',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveThought('', mockThought);
              await result.current.saveThought('sermon-123_abc', mockThought);
            });
            expect(mockUpdateThought).toHaveBeenCalledWith('', mockThought);
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-123_abc', mockThought);
          },
        },
      ]);
    });
  });

  describe('saveStructure', () => {
    it('handles structure saves across payload sizes in one test', async () => {
      await runScenarios([
        {
          name: 'success path',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveStructure('sermon-1', mockStructure);
            });
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
          },
        },
        {
          name: 'error surfaces toast',
          run: async () => {
            mockUpdateStructure.mockRejectedValueOnce(new Error('Save failed'));
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveStructure('sermon-1', mockStructure);
            });
            expect(mockToast.error).toHaveBeenCalled();
          },
        },
        {
          name: 'empty and large structures',
          run: async () => {
            const emptyStructure: ThoughtsBySection = { introduction: [], main: [], conclusion: [], ambiguous: [] };
            const largeStructure: ThoughtsBySection = {
              introduction: Array.from({ length: 100 }, (_, i) => `thought-${i}`),
              main: Array.from({ length: 50 }, (_, i) => `main-${i}`),
              conclusion: Array.from({ length: 25 }, (_, i) => `conclusion-${i}`),
              ambiguous: [],
            };
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveStructure('sermon-1', emptyStructure);
              await result.current.saveStructure('sermon-1', largeStructure);
            });
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', emptyStructure);
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', largeStructure);
          },
        },
      ]);
    });
  });

  describe('debouncedSaveThought', () => {
    it('debounces repeated triggers while honoring latest payload', async () => {
      await runScenarios([
        {
          name: 'collapses bursts',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveThought('sermon-1', mockThought);
              result.current.debouncedSaveThought('sermon-1', mockThought);
              result.current.debouncedSaveThought('sermon-1', mockThought);
            });
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledTimes(1);
          },
        },
        {
          name: 'latest thought wins',
          run: async () => {
            const thought2: Thought = { ...mockThought, id: 'thought-2', text: 'Test thought 2' };
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveThought('sermon-1', mockThought);
              result.current.debouncedSaveThought('sermon-1', thought2);
            });
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', thought2);
          },
        },
        {
          name: 'latest sermonId wins',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveThought('sermon-1', mockThought);
              result.current.debouncedSaveThought('sermon-2', mockThought);
            });
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-2', mockThought);
          },
        },
      ]);
    });
  });

  describe('debouncedSaveStructure', () => {
    it('debounces structure updates similarly to thoughts', async () => {
      await runScenarios([
        {
          name: 'collapses duplicates',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveStructure('sermon-1', mockStructure);
              result.current.debouncedSaveStructure('sermon-1', mockStructure);
            });
            await flushDebounce();
            expect(mockUpdateStructure).toHaveBeenCalledTimes(1);
          },
        },
        {
          name: 'latest structure wins',
          run: async () => {
            const structure2: ThoughtsBySection = { ...mockStructure, introduction: ['thought-3'] };
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveStructure('sermon-1', mockStructure);
              result.current.debouncedSaveStructure('sermon-1', structure2);
            });
            await flushDebounce();
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', structure2);
          },
        },
        {
          name: 'latest sermonId wins',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveStructure('sermon-1', mockStructure);
              result.current.debouncedSaveStructure('sermon-2', mockStructure);
            });
            await flushDebounce();
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-2', mockStructure);
          },
        },
      ]);
    });
  });

  describe('error handling', () => {
    it('funnels diverse errors to the toast layer in a single test', async () => {
      const errorMessages = ['Network error', 'Timeout', 'Validation failed'];
      for (const message of errorMessages) {
        mockUpdateThought.mockRejectedValueOnce(new Error(message));
        const { result } = renderHook(() => usePersistence(defaultProps));
        await act(async () => {
          await result.current.saveThought('sermon-1', mockThought);
        });
        expect(mockToast.error).toHaveBeenCalled();
        mockToast.error.mockClear();
      }

      mockUpdateStructure.mockRejectedValueOnce(new Error('Invalid structure'));
      const { result: structureResult } = renderHook(() => usePersistence(defaultProps));
      await act(async () => {
        await structureResult.current.saveStructure('sermon-1', mockStructure);
      });
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe('performance and optimization', () => {
    it('validates debouncing, payload size, and concurrency in one grouping', async () => {
      await runScenarios([
        {
          name: 'rapid debounce loop',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            const start = Date.now();
            for (let i = 0; i < 100; i++) {
              act(() => result.current.debouncedSaveThought('sermon-1', mockThought));
            }
            expect(Date.now() - start).toBeLessThan(100);
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledTimes(1);
            mockUpdateThought.mockClear();
          },
        },
        {
          name: 'large payload',
          run: async () => {
            const largeThought: Thought = {
              ...mockThought,
              text: 'A'.repeat(10000),
              tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
            };
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveThought('sermon-1', largeThought);
            });
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', largeThought);
            mockUpdateThought.mockClear();
          },
        },
        {
          name: 'concurrent saves',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                  result.current.saveThought(`sermon-${i}`, { ...mockThought, id: `thought-${i}` }),
                ),
              );
            });
            expect(mockUpdateThought).toHaveBeenCalledTimes(10);
          },
        },
      ]);
    });
  });

  describe('integration scenarios', () => {
    it('runs full workflows (immediate, debounced, mixed) in one go', async () => {
      await runScenarios([
        {
          name: 'immediate saves',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            await act(async () => {
              await result.current.saveThought('sermon-1', mockThought);
              await result.current.saveStructure('sermon-1', mockStructure);
            });
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
            mockUpdateThought.mockClear();
            mockUpdateStructure.mockClear();
          },
        },
        {
          name: 'debounced saves',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => {
              result.current.debouncedSaveThought('sermon-1', mockThought);
              result.current.debouncedSaveStructure('sermon-1', mockStructure);
            });
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
            mockUpdateThought.mockClear();
            mockUpdateStructure.mockClear();
          },
        },
        {
          name: 'mixed saves',
          run: async () => {
            const { result } = renderHook(() => usePersistence(defaultProps));
            act(() => result.current.debouncedSaveThought('sermon-1', mockThought));
            await act(async () => {
              await result.current.saveStructure('sermon-1', mockStructure);
            });
            expect(mockUpdateStructure).toHaveBeenCalledWith('sermon-1', mockStructure);
            await flushDebounce();
            expect(mockUpdateThought).toHaveBeenCalledWith('sermon-1', mockThought);
          },
        },
      ]);
    });
  });

  describe('edge cases', () => {
    it('covers unusual sermonId shapes in a single test', async () => {
      const variants = [null, undefined, '', 'a'.repeat(1000)];
      const { result } = renderHook(() => usePersistence(defaultProps));
      for (const sermonId of variants) {
        await act(async () => {
          await result.current.saveThought(sermonId as any, mockThought);
        });
        expect(mockUpdateThought).toHaveBeenCalledWith(sermonId, mockThought);
        mockUpdateThought.mockClear();
      }
    });
  });

  describe('toast notifications', () => {
    it('centralizes toast expectations', async () => {
      mockUpdateThought.mockRejectedValueOnce(new Error('Save failed'));
      const { result } = renderHook(() => usePersistence(defaultProps));
      await act(async () => {
        await result.current.saveThought('sermon-1', mockThought);
      });
      expect(mockToast.error).toHaveBeenCalled();
      mockToast.error.mockClear();

      mockUpdateStructure.mockRejectedValueOnce(new Error('Save failed'));
      const { result: structureResult } = renderHook(() => usePersistence(defaultProps));
      await act(async () => {
        await structureResult.current.saveStructure('sermon-1', mockStructure);
      });
      expect(mockToast.error).toHaveBeenCalled();

      const { result: successResult } = renderHook(() => usePersistence(defaultProps));
      await act(async () => {
        await successResult.current.saveThought('sermon-1', mockThought);
      });
      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });
});
