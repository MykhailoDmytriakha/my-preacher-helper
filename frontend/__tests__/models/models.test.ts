  describe('Thought model with forceTag', () => {
    it('should have forceTag as optional property', () => {
      const thought: Thought = {
        id: 'thought-1',
        text: 'Test thought',
        tags: ['tag1'],
        date: new Date().toISOString(),
      };

      // Should work without forceTag
      expect(thought).toHaveProperty('id', 'thought-1');
      expect(thought).toHaveProperty('text', 'Test thought');
      expect(thought).toHaveProperty('tags', ['tag1']);
      expect(thought).toHaveProperty('date');
      expect(thought).not.toHaveProperty('forceTag');
    });

    it('should support forceTag property', () => {
      const thought: Thought = {
        id: 'thought-2',
        text: 'Audio thought',
        tags: ['Вступление'],
        date: new Date().toISOString(),
        forceTag: 'Вступление',
      };

      expect(thought).toHaveProperty('forceTag', 'Вступление');
    });

    it('should support different forceTag values', () => {
      const forceTags = ['Вступление', 'Основная часть', 'Заключение'];
      
      forceTags.forEach(forceTag => {
        const thought: Thought = {
          id: `thought-${forceTag}`,
          text: 'Audio thought',
          tags: [forceTag],
          date: new Date().toISOString(),
          forceTag,
        };

        expect(thought.forceTag).toBe(forceTag);
      });
    });

    it('should maintain backward compatibility', () => {
      // Old thought without forceTag should still work
      const oldThought: Thought = {
        id: 'old-thought',
        text: 'Old thought',
        tags: ['old-tag'],
        date: new Date().toISOString(),
      };

      expect(oldThought).toBeDefined();
      expect(oldThought.id).toBe('old-thought');
      expect(oldThought.forceTag).toBeUndefined();
    });
  });
