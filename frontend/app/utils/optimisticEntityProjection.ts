import type { OptimisticEntityRecord, OptimisticEntitySyncState } from "@/models/optimisticEntities";

interface ProjectEntitiesOptions {
  createPlacement?: "start" | "end";
}

export function projectOptimisticEntities<TEntity extends { id: string }>(
  baseEntities: TEntity[],
  records: OptimisticEntityRecord<TEntity>[],
  options: ProjectEntitiesOptions = {}
): TEntity[] {
  const createPlacement = options.createPlacement ?? "start";
  const byId = new Map(baseEntities.map((entity) => [entity.id, entity]));
  const orderedBaseIds = baseEntities.map((entity) => entity.id);
  const extraCreateIds: string[] = [];

  records
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .forEach((record) => {
      const existing = byId.get(record.entityId);
      const isStale =
        existing &&
        (existing as { version?: number }).version !== undefined &&
        (record.entity as { version?: number }).version !== undefined &&
        (record.entity as { version?: number }).version! < (existing as { version?: number }).version!;

      if (isStale) return;

      if (record.operation === "create") {
        byId.set(record.entityId, record.entity);
        if (!orderedBaseIds.includes(record.entityId) && !extraCreateIds.includes(record.entityId)) {
          extraCreateIds.push(record.entityId);
        }
        return;
      }

      if (record.operation === "update") {
        byId.set(record.entityId, record.entity);
        return;
      }

      if (record.operation === "delete") {
        byId.delete(record.entityId);
      }
    });

  const baseProjected = orderedBaseIds
    .map((id) => byId.get(id))
    .filter(Boolean) as TEntity[];

  const extraCreates = extraCreateIds
    .map((id) => byId.get(id))
    .filter(Boolean) as TEntity[];

  return createPlacement === "start"
    ? [...extraCreates.reverse(), ...baseProjected]
    : [...baseProjected, ...extraCreates];
}

export function buildOptimisticSyncStateById<TEntity extends { id: string }>(
  records: OptimisticEntityRecord<TEntity>[]
): Record<string, OptimisticEntitySyncState> {
  return records.reduce<Record<string, OptimisticEntitySyncState>>((acc, record) => {
    acc[record.entityId] = {
      status: record.status === "sending" ? "pending" : record.status,
      operation: record.operation,
      expiresAt: record.expiresAt,
      lastError: record.lastError,
      successAt: record.successAt,
    };
    return acc;
  }, {});
}
