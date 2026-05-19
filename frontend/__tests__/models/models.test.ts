import { Thought, SermonPoint } from '@/models/models';

describe('Thought model', () => {
    it('should support the core thought fields', () => {
      const thought: Thought = {
        id: 'thought-1',
        text: 'Test thought',
        tags: ['tag1'],
        date: new Date().toISOString(),
      };

      expect(thought).toHaveProperty('id', 'thought-1');
      expect(thought).toHaveProperty('text', 'Test thought');
      expect(thought).toHaveProperty('tags', ['tag1']);
      expect(thought).toHaveProperty('date');
    });

    it('should support optional outline metadata', () => {
      const thought: Thought = {
        id: 'thought-2',
        text: 'Audio thought',
        tags: ['custom-tag'],
        date: new Date().toISOString(),
        outlinePointId: 'op-1',
        subPointId: 'sp-1',
      };

      expect(thought.outlinePointId).toBe('op-1');
      expect(thought.subPointId).toBe('sp-1');
    });

    it('should maintain backward compatibility', () => {
      const oldThought: Thought = {
        id: 'old-thought',
        text: 'Old thought',
        tags: ['old-tag'],
        date: new Date().toISOString(),
      };

      expect(oldThought).toBeDefined();
      expect(oldThought.id).toBe('old-thought');
      expect(oldThought.outlinePointId).toBeUndefined();
    });
  });

  describe('SermonPoint Model', () => {
    describe('isReviewed field', () => {
      it('should allow undefined isReviewed field', () => {
        const outlinePoint: SermonPoint = {
          id: 'op1',
          text: 'Test outline point',
        };

        expect(outlinePoint.isReviewed).toBeUndefined();
        expect(outlinePoint.id).toBe('op1');
        expect(outlinePoint.text).toBe('Test outline point');
      });

      it('should allow false isReviewed field', () => {
        const outlinePoint: SermonPoint = {
          id: 'op1',
          text: 'Test outline point',
          isReviewed: false,
        };

        expect(outlinePoint.isReviewed).toBe(false);
      });

      it('should allow true isReviewed field', () => {
        const outlinePoint: SermonPoint = {
          id: 'op1',
          text: 'Test outline point',
          isReviewed: true,
        };

        expect(outlinePoint.isReviewed).toBe(true);
      });

      it('should be compatible with existing SermonPoint structure', () => {
        const outlinePoints: SermonPoint[] = [
          { id: 'op1', text: 'Point 1' },
          { id: 'op2', text: 'Point 2', isReviewed: false },
          { id: 'op3', text: 'Point 3', isReviewed: true },
        ];

        expect(outlinePoints).toHaveLength(3);
        expect(outlinePoints[0].isReviewed).toBeUndefined();
        expect(outlinePoints[1].isReviewed).toBe(false);
        expect(outlinePoints[2].isReviewed).toBe(true);
      });
    });
  });
