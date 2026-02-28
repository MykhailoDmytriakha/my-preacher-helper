import { act, renderHook } from '@testing-library/react';

import { useOptimisticEntitySync } from '@/hooks/useOptimisticEntitySync';

type TestEntity = {
  id: string;
  text: string;
};

describe('useOptimisticEntitySync', () => {
  it('exposes newly created records to same-tick lookup helpers', () => {
    const loadRecords = jest.fn().mockImplementation(() => new Promise(() => undefined));
    const saveRecords = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOptimisticEntitySync<TestEntity>({
        entityType: 'thought',
        scopeId: 'sermon-1',
        persistence: {
          loadRecords,
          saveRecords,
        },
      })
    );

    let createdLocalId = '';
    act(() => {
      const record = result.current.createRecord({
        entityId: 'local-1',
        operation: 'create',
        entity: {
          id: 'local-1',
          text: 'Pending thought',
        },
      });

      createdLocalId = record?.localId ?? '';
      expect(result.current.getLatestRecordByEntityId('local-1')).toMatchObject({
        localId: createdLocalId,
        entityId: 'local-1',
      });
    });

    expect(createdLocalId).not.toBe('');
    expect(result.current.getRecordByLocalId(createdLocalId)).toMatchObject({
      entityId: 'local-1',
      entity: {
        id: 'local-1',
        text: 'Pending thought',
      },
    });
  });

  it('updates, marks status, and removes records', async () => {
    const loadRecords = jest.fn().mockResolvedValue([]);
    const saveRecords = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOptimisticEntitySync<TestEntity>({
        entityType: 'thought',
        scopeId: 'sermon-1',
        persistence: {
          loadRecords,
          saveRecords,
        },
      })
    );

    let localId = '';
    act(() => {
      const record = result.current.createRecord({
        entityId: 't-1',
        operation: 'update',
        entity: { id: 't-1', text: 'Original' },
      });
      localId = record?.localId ?? '';
    });

    expect(result.current.records).toHaveLength(1);

    act(() => {
      result.current.updateRecord(localId, (r) => ({
        ...r,
        entity: { ...r.entity, text: 'Updated' },
      }));
    });
    expect(result.current.getRecordByLocalId(localId)?.entity.text).toBe('Updated');

    act(() => {
      result.current.markRecordStatus(localId, 'success', { successAt: 'today' });
    });
    expect(result.current.getRecordByLocalId(localId)?.status).toBe('success');
    expect(result.current.getRecordByLocalId(localId)?.successAt).toBe('today');

    act(() => {
      result.current.replaceRecordEntity(localId, { id: 't-1-final', text: 'Final' }, { entityId: 't-1-final' });
    });
    expect(result.current.getRecordByLocalId(localId)?.entityId).toBe('t-1-final');

    act(() => {
      result.current.removeRecord(localId);
    });
    expect(result.current.records).toHaveLength(0);
  });

  it('loads records from persistence on mount and normalizes "sending" to "error"', async () => {
    const persisted: any[] = [
      {
        localId: 'l1',
        entityId: 'e1',
        status: 'sending', // Should be normalized to error
        entity: { id: 'e1', text: 'Stuck' },
      },
      {
        localId: 'l2',
        entityId: 'e2',
        status: 'pending',
        entity: { id: 'e2', text: 'Pending' },
      },
    ];
    const loadRecords = jest.fn().mockResolvedValue(persisted);
    const saveRecords = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOptimisticEntitySync<TestEntity>({
        entityType: 'thought',
        scopeId: 'sermon-1',
        persistence: {
          loadRecords,
          saveRecords,
        },
      })
    );

    await act(async () => {
      // Wait for useEffect to finish loading
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.records).toHaveLength(2);
    expect(result.current.getRecordByLocalId('l1')?.status).toBe('error');
    expect(result.current.getRecordByLocalId('l2')?.status).toBe('pending');
  });
});
