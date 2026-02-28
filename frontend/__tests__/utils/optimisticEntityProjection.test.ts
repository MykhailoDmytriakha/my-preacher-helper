import { buildOptimisticSyncStateById, projectOptimisticEntities } from '@/utils/optimisticEntityProjection';
import { OptimisticEntityRecord } from '@/models/optimisticEntities';

describe('optimisticEntityProjection', () => {
  interface MockEntity {
    id: string;
    text: string;
    version?: number;
  }

  it('projects UPDATE operations over base entities', () => {
    const base: MockEntity[] = [
      { id: '1', text: 'base 1' },
      { id: '2', text: 'base 2' },
    ];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l1',
        entityId: '1',
        operation: 'update',
        status: 'pending',
        entity: { id: '1', text: 'updated 1' },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records);
    expect(projected).toHaveLength(2);
    expect(projected.find(e => e.id === '1')?.text).toBe('updated 1');
  });

  it('projects CREATE operations by appending to base entities', () => {
    const base: MockEntity[] = [{ id: '1', text: 'base 1' }];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l2',
        entityId: '2',
        operation: 'create',
        status: 'pending',
        entity: { id: '2', text: 'new 2' },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records);
    expect(projected).toHaveLength(2);
    expect(projected.find(e => e.id === '2')?.text).toBe('new 2');
  });

  it('projects DELETE operations by removing from base entities', () => {
    const base: MockEntity[] = [
      { id: '1', text: 'base 1' },
      { id: '2', text: 'base 2' },
    ];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l2',
        entityId: '2',
        operation: 'delete',
        status: 'pending',
        entity: { id: '2', text: 'base 2' },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records);
    expect(projected).toHaveLength(1);
    expect(projected.find(e => e.id === '2')).toBeUndefined();
  });

  it('respects versions if present and prevents stale updates', () => {
    const base: MockEntity[] = [{ id: '1', text: 'v10', version: 10 }];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l1',
        entityId: '1',
        operation: 'update',
        status: 'pending',
        entity: { id: '1', text: 'v5', version: 5 },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records);
    expect(projected[0].text).toBe('v10');
  });

  it('applies updates if versions are equal or higher', () => {
    const base: MockEntity[] = [{ id: '1', text: 'v10', version: 10 }];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l1',
        entityId: '1',
        operation: 'update',
        status: 'pending',
        entity: { id: '1', text: 'v11', version: 11 },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records);
    expect(projected[0].text).toBe('v11');
  });

  it('appends optimistic creates when requested', () => {
    const base: MockEntity[] = [{ id: '1', text: 'base 1' }];
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l2',
        entityId: '2',
        operation: 'create',
        status: 'pending',
        entity: { id: '2', text: 'new 2' },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: '',
      },
    ];

    const projected = projectOptimisticEntities(base, records, { createPlacement: 'end' });
    expect(projected.map((entity) => entity.id)).toEqual(['1', '2']);
  });

  it('builds sync state by entity id and normalizes sending to pending', () => {
    const records: OptimisticEntityRecord<MockEntity>[] = [
      {
        localId: 'l1',
        entityId: '1',
        operation: 'update',
        status: 'sending',
        entity: { id: '1', text: 'updated' },
        entityType: 'test',
        scopeId: 's1',
        createdAt: '',
        lastAttemptAt: '',
        expiresAt: 'exp-1',
        lastError: 'old error',
        successAt: 'success-1',
      },
    ];

    expect(buildOptimisticSyncStateById(records)).toEqual({
      '1': {
        status: 'pending',
        operation: 'update',
        expiresAt: 'exp-1',
        lastError: 'old error',
        successAt: 'success-1',
      },
    });
  });
});
