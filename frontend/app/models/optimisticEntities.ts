export type OptimisticEntityOperation = "create" | "update" | "delete";

export type OptimisticEntityStatus = "pending" | "sending" | "error" | "success";

export interface OptimisticEntityRecord<TEntity extends { id: string }> {
  localId: string;
  entityType: string;
  scopeId: string;
  entityId: string;
  operation: OptimisticEntityOperation;
  status: OptimisticEntityStatus;
  entity: TEntity;
  snapshot?: TEntity;
  createdAt: string;
  lastAttemptAt: string;
  expiresAt: string;
  lastError?: string;
  successAt?: string;
}

export interface OptimisticEntitySyncState {
  status: "pending" | "error" | "success";
  operation: OptimisticEntityOperation;
  expiresAt?: string;
  lastError?: string;
  successAt?: string;
}
